import "@webcomponents/custom-elements";
import "lit/polyfill-support.js";
import { FocusableElement, tabbable } from "tabbable";

import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import {
  EVENTS,
  AutofillOverlayVisibility,
  AUTOFILL_OVERLAY_ON_SCROLL,
  AUTOFILL_OVERLAY_ON_RESIZE,
} from "@bitwarden/common/autofill/constants";

import {
  FocusedFieldData,
  SubFrameOffsetData,
} from "../background/abstractions/overlay.background";
import { AutofillExtensionMessage } from "../content/abstractions/autofill-init";
import {
  AutofillOverlayElement,
  MAX_SUB_FRAME_DEPTH,
  RedirectFocusDirection,
} from "../enums/autofill-overlay.enum";
import AutofillField from "../models/autofill-field";
import AutofillPageDetails from "../models/autofill-page-details";
import { ElementWithOpId, FillableFormFieldElement, FormFieldElement } from "../types";
import {
  elementIsFillableFormField,
  getAttributeBoolean,
  sendExtensionMessage,
  throttle,
} from "../utils";

import {
  AutofillOverlayContentExtensionMessage,
  AutofillOverlayContentExtensionMessageHandlers,
  AutofillOverlayContentService as AutofillOverlayContentServiceInterface,
  OpenAutofillInlineMenuOptions,
  SubFrameDataFromWindowMessage,
} from "./abstractions/autofill-overlay-content.service";
import { InlineMenuFieldQualificationService } from "./abstractions/inline-menu-field-qualifications.service";
import { AutoFillConstants } from "./autofill-constants";

export class AutofillOverlayContentService implements AutofillOverlayContentServiceInterface {
  pageDetailsUpdateRequired = false;
  inlineMenuVisibility: number;
  private readonly findTabs = tabbable;
  private readonly sendExtensionMessage = sendExtensionMessage;
  private formFieldElements: Set<ElementWithOpId<FormFieldElement>> = new Set([]);
  private hiddenFormFieldElements: WeakMap<ElementWithOpId<FormFieldElement>, AutofillField> =
    new WeakMap();
  private ignoredFieldTypes: Set<string> = new Set(AutoFillConstants.ExcludedInlineMenuTypes);
  private userFilledFields: Record<string, FillableFormFieldElement> = {};
  private authStatus: AuthenticationStatus;
  private focusableElements: FocusableElement[] = [];
  private mostRecentlyFocusedField: ElementWithOpId<FormFieldElement>;
  private focusedFieldData: FocusedFieldData;
  private closeInlineMenuOnRedirectTimeout: number | NodeJS.Timeout;
  private focusInlineMenuListTimeout: number | NodeJS.Timeout;
  private eventHandlersMemo: { [key: string]: EventListener } = {};
  private readonly extensionMessageHandlers: AutofillOverlayContentExtensionMessageHandlers = {
    openAutofillInlineMenu: ({ message }) => this.openInlineMenu(message),
    addNewVaultItemFromOverlay: () => this.addNewVaultItem(),
    blurMostRecentlyFocusedField: () => this.blurMostRecentlyFocusedField(),
    unsetMostRecentlyFocusedField: () => this.unsetMostRecentlyFocusedField(),
    checkIsMostRecentlyFocusedFieldWithinViewport: () =>
      this.checkIsMostRecentlyFocusedFieldWithinViewport(),
    bgUnlockPopoutOpened: () => this.blurMostRecentlyFocusedField(true),
    bgVaultItemRepromptPopoutOpened: () => this.blurMostRecentlyFocusedField(true),
    redirectAutofillInlineMenuFocusOut: ({ message }) =>
      this.redirectInlineMenuFocusOut(message?.data?.direction),
    updateAutofillInlineMenuVisibility: ({ message }) => this.updateInlineMenuVisibility(message),
    getSubFrameOffsets: ({ message }) => this.getSubFrameOffsets(message),
    getSubFrameOffsetsFromWindowMessage: ({ message }) =>
      this.getSubFrameOffsetsFromWindowMessage(message),
    checkMostRecentlyFocusedFieldHasValue: () => this.mostRecentlyFocusedFieldHasValue(),
    setupRebuildSubFrameOffsetsListeners: () => this.setupRebuildSubFrameOffsetsListeners(),
    destroyAutofillInlineMenuListeners: () => this.destroy(),
  };

  constructor(
    private port: chrome.runtime.Port,
    private inlineMenuFieldQualificationService: InlineMenuFieldQualificationService,
  ) {}

  /**
   * Initializes the autofill overlay content service by setting up the mutation observers.
   * The observers will be instantiated on DOMContentLoaded if the page is current loading.
   */
  init() {
    if (globalThis.document.readyState === "loading") {
      globalThis.document.addEventListener(EVENTS.DOMCONTENTLOADED, this.setupGlobalEventListeners);
      return;
    }

    this.setupGlobalEventListeners();
  }

  /**
   * Getter used to access the extension message handlers associated
   * with the autofill overlay content service.
   */
  get messageHandlers(): AutofillOverlayContentExtensionMessageHandlers {
    return this.extensionMessageHandlers;
  }

  /**
   * Sets up the autofill inline menu listener on the form field element. This method is called
   * during the page details collection process.
   *
   * @param formFieldElement - Form field elements identified during the page details collection process.
   * @param autofillFieldData - Autofill field data captured from the form field element.
   * @param pageDetails - The collected page details from the tab.
   */
  async setupInlineMenu(
    formFieldElement: ElementWithOpId<FormFieldElement>,
    autofillFieldData: AutofillField,
    pageDetails: AutofillPageDetails,
  ) {
    if (
      this.formFieldElements.has(formFieldElement) ||
      this.isIgnoredField(autofillFieldData, pageDetails)
    ) {
      return;
    }

    if (this.isHiddenField(formFieldElement, autofillFieldData)) {
      return;
    }

    await this.setupInlineMenuOnQualifiedField(formFieldElement);
  }

  private async setupInlineMenuOnQualifiedField(
    formFieldElement: ElementWithOpId<FormFieldElement>,
  ) {
    this.formFieldElements.add(formFieldElement);

    if (!this.mostRecentlyFocusedField) {
      await this.updateMostRecentlyFocusedField(formFieldElement);
    }

    if (!this.inlineMenuVisibility) {
      await this.getInlineMenuVisibility();
    }

    this.setupFormFieldElementEventListeners(formFieldElement);

    if (this.getRootNodeActiveElement(formFieldElement) === formFieldElement) {
      await this.triggerFormFieldFocusedAction(formFieldElement);
    }
  }

  /**
   * Handles opening the autofill inline menu. Will conditionally open
   * the inline menu based on the current inline menu visibility setting.
   * Allows you to optionally focus the field element when opening the inline menu.
   * Will also optionally ignore the inline menu visibility setting and open the
   *
   * @param options - Options for opening the autofill inline menu.
   */
  openInlineMenu(options: OpenAutofillInlineMenuOptions = {}) {
    const { isFocusingFieldElement, isOpeningFullInlineMenu, authStatus } = options;
    if (!this.mostRecentlyFocusedField) {
      return;
    }

    if (this.pageDetailsUpdateRequired) {
      void this.sendExtensionMessage("bgCollectPageDetails", {
        sender: "autofillOverlayContentService",
      });
      this.pageDetailsUpdateRequired = false;
    }

    if (isFocusingFieldElement && !this.recentlyFocusedFieldIsCurrentlyFocused()) {
      this.focusMostRecentlyFocusedField();
    }

    if (typeof authStatus !== "undefined") {
      this.authStatus = authStatus;
    }

    if (
      this.inlineMenuVisibility === AutofillOverlayVisibility.OnButtonClick &&
      !isOpeningFullInlineMenu
    ) {
      this.updateInlineMenuButtonPosition();
      return;
    }

    this.updateInlineMenuElementsPosition();
  }

  /**
   * Focuses the most recently focused field element.
   */
  focusMostRecentlyFocusedField() {
    this.mostRecentlyFocusedField?.focus();
  }

  /**
   * Removes focus from the most recently focused field element.
   */
  blurMostRecentlyFocusedField(isClosingInlineMenu: boolean = false) {
    this.mostRecentlyFocusedField?.blur();

    if (isClosingInlineMenu) {
      this.sendPortMessage("closeAutofillInlineMenu");
    }
  }

  /**
   * Sets the most recently focused field within the current frame to a `null` value.
   */
  unsetMostRecentlyFocusedField() {
    this.mostRecentlyFocusedField = null;
  }

  /**
   * Formats any found user filled fields for a login cipher and sends a message
   * to the background script to add a new cipher.
   */
  async addNewVaultItem() {
    if (!(await this.isInlineMenuListVisible())) {
      return;
    }

    const login = {
      username: this.userFilledFields["username"]?.value || "",
      password: this.userFilledFields["password"]?.value || "",
      uri: globalThis.document.URL,
      hostname: globalThis.document.location.hostname,
    };

    this.sendPortMessage("autofillOverlayAddNewVaultItem", { login });
  }

  /**
   * Redirects the keyboard focus out of the inline menu, selecting the element that is
   * either previous or next in the tab order. If the direction is current, the most
   * recently focused field will be focused.
   *
   * @param direction - The direction to redirect the focus out.
   */
  private async redirectInlineMenuFocusOut(direction?: string) {
    if (!direction || !this.mostRecentlyFocusedField || !(await this.isInlineMenuListVisible())) {
      return;
    }

    if (direction === RedirectFocusDirection.Current) {
      this.focusMostRecentlyFocusedField();
      this.closeInlineMenuOnRedirectTimeout = globalThis.setTimeout(
        () => this.sendPortMessage("closeAutofillInlineMenu"),
        100,
      );
      return;
    }

    if (!this.focusableElements.length) {
      this.focusableElements = this.findTabs(globalThis.document.body, { getShadowRoot: true });
    }

    const focusedElementIndex = this.focusableElements.findIndex(
      (element) => element === this.mostRecentlyFocusedField,
    );

    const indexOffset = direction === RedirectFocusDirection.Previous ? -1 : 1;
    const redirectFocusElement = this.focusableElements[focusedElementIndex + indexOffset];
    redirectFocusElement?.focus();
  }

  /**
   * Sets up the event listeners that facilitate interaction with the form field elements.
   * Will clear any cached form field element handlers that are encountered when setting
   * up a form field element.
   *
   * @param formFieldElement - The form field element to set up the event listeners for.
   */
  private setupFormFieldElementEventListeners(formFieldElement: ElementWithOpId<FormFieldElement>) {
    this.removeCachedFormFieldEventListeners(formFieldElement);

    formFieldElement.addEventListener(EVENTS.BLUR, this.handleFormFieldBlurEvent);
    formFieldElement.addEventListener(EVENTS.KEYUP, this.handleFormFieldKeyupEvent);
    formFieldElement.addEventListener(
      EVENTS.INPUT,
      this.handleFormFieldInputEvent(formFieldElement),
    );
    formFieldElement.addEventListener(
      EVENTS.CLICK,
      this.handleFormFieldClickEvent(formFieldElement),
    );
    formFieldElement.addEventListener(
      EVENTS.FOCUS,
      this.handleFormFieldFocusEvent(formFieldElement),
    );
  }

  /**
   * Removes any cached form field element handlers that are encountered
   * when setting up a form field element to present the inline menu.
   *
   * @param formFieldElement - The form field element to remove the cached handlers for.
   */
  private removeCachedFormFieldEventListeners(formFieldElement: ElementWithOpId<FormFieldElement>) {
    const handlers = [EVENTS.INPUT, EVENTS.CLICK, EVENTS.FOCUS];
    for (let index = 0; index < handlers.length; index++) {
      const event = handlers[index];
      const memoIndex = this.getFormFieldHandlerMemoIndex(formFieldElement, event);
      const existingHandler = this.eventHandlersMemo[memoIndex];
      if (!existingHandler) {
        return;
      }

      formFieldElement.removeEventListener(event, existingHandler);
      delete this.eventHandlersMemo[memoIndex];
    }
  }

  /**
   * Helper method that facilitates registration of an event handler to a form field element.
   *
   * @param eventHandler - The event handler to memoize.
   * @param memoIndex - The memo index to use for the event handler.
   */
  private useEventHandlersMemo = (eventHandler: EventListener, memoIndex: string) => {
    return this.eventHandlersMemo[memoIndex] || (this.eventHandlersMemo[memoIndex] = eventHandler);
  };

  /**
   * Formats the memoIndex for the form field event handler.
   *
   * @param formFieldElement - The form field element to format the memo index for.
   * @param event - The event to format the memo index for.
   */
  private getFormFieldHandlerMemoIndex(
    formFieldElement: ElementWithOpId<FormFieldElement>,
    event: string,
  ) {
    return `${formFieldElement.opid}-${formFieldElement.id}-${event}-handler`;
  }

  /**
   * Form Field blur event handler. Updates the value identifying whether
   * the field is focused and sends a message to check if the inline menu itself
   * is currently focused.
   */
  private handleFormFieldBlurEvent = () => {
    this.sendPortMessage("updateIsFieldCurrentlyFocused", {
      isFieldCurrentlyFocused: false,
    });
    this.sendPortMessage("checkAutofillInlineMenuFocused");
  };

  /**
   * Form field keyup event handler. Facilitates the ability to remove the
   * autofill inline menu using the escape key, focusing the inline menu list using
   * the ArrowDown key, and ensuring that the inline menu is repositioned when
   * the form is submitted using the Enter key.
   *
   * @param event - The keyup event.
   */
  private handleFormFieldKeyupEvent = async (event: KeyboardEvent) => {
    const eventCode = event.code;
    if (eventCode === "Escape") {
      this.sendPortMessage("closeAutofillInlineMenu", {
        forceCloseInlineMenu: true,
      });
      return;
    }

    if (eventCode === "Enter" && !(await this.isFieldCurrentlyFilling())) {
      this.handleOverlayRepositionEvent();
      return;
    }

    if (eventCode === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();

      void this.focusInlineMenuList();
    }
  };

  /**
   * Triggers a focus of the inline menu list, if it is visible. If the list is not visible,
   * the inline menu will be opened and the list will be focused after a short delay. Ensures
   * that the inline menu list is focused when the user presses the down arrow key.
   */
  private async focusInlineMenuList() {
    if (this.mostRecentlyFocusedField && !(await this.isInlineMenuListVisible())) {
      this.clearFocusInlineMenuListTimeout();
      await this.updateMostRecentlyFocusedField(this.mostRecentlyFocusedField);
      this.openInlineMenu({ isOpeningFullInlineMenu: true });
      this.focusInlineMenuListTimeout = globalThis.setTimeout(
        () => this.sendPortMessage("focusAutofillInlineMenuList"),
        125,
      );
      return;
    }

    this.sendPortMessage("focusAutofillInlineMenuList");
  }

  /**
   * Sets up and memoizes the form field input event handler.
   *
   * @param formFieldElement - The form field element that triggered the input event.
   */
  private handleFormFieldInputEvent = (formFieldElement: ElementWithOpId<FormFieldElement>) => {
    return this.useEventHandlersMemo(
      () => this.triggerFormFieldInput(formFieldElement),
      this.getFormFieldHandlerMemoIndex(formFieldElement, EVENTS.INPUT),
    );
  };

  /**
   * Triggers when the form field element receives an input event. This method will
   * store the modified form element data for use when the user attempts to add a new
   * vault item. It also acts to remove the inline menu list while the user is typing.
   *
   * @param formFieldElement - The form field element that triggered the input event.
   */
  private async triggerFormFieldInput(formFieldElement: ElementWithOpId<FormFieldElement>) {
    if (!elementIsFillableFormField(formFieldElement)) {
      return;
    }

    this.storeModifiedFormElement(formFieldElement);

    if (await this.hideInlineMenuListOnFilledField(formFieldElement)) {
      this.sendPortMessage("closeAutofillInlineMenu", {
        overlayElement: AutofillOverlayElement.List,
        forceCloseInlineMenu: true,
      });
      return;
    }

    this.openInlineMenu();
  }

  /**
   * Stores the modified form element data for use when the user attempts to add a new
   * vault item. This method will also store the most recently focused field, if it is
   * not already stored.
   *
   * @param formFieldElement
   * @private
   */
  private storeModifiedFormElement(formFieldElement: ElementWithOpId<FillableFormFieldElement>) {
    if (formFieldElement !== this.mostRecentlyFocusedField) {
      void this.updateMostRecentlyFocusedField(formFieldElement);
    }

    if (formFieldElement.type === "password") {
      this.userFilledFields.password = formFieldElement;
      return;
    }

    this.userFilledFields.username = formFieldElement;
  }

  /**
   * Sets up and memoizes the form field click event handler.
   *
   * @param formFieldElement - The form field element that triggered the click event.
   */
  private handleFormFieldClickEvent = (formFieldElement: ElementWithOpId<FormFieldElement>) => {
    return this.useEventHandlersMemo(
      () => this.triggerFormFieldClickedAction(formFieldElement),
      this.getFormFieldHandlerMemoIndex(formFieldElement, EVENTS.CLICK),
    );
  };

  /**
   * Triggers when the form field element receives a click event. This method will
   * trigger the focused action for the form field element if the inline menu is not visible.
   *
   * @param formFieldElement - The form field element that triggered the click event.
   */
  private async triggerFormFieldClickedAction(formFieldElement: ElementWithOpId<FormFieldElement>) {
    if ((await this.isInlineMenuButtonVisible()) || (await this.isInlineMenuListVisible())) {
      return;
    }

    await this.triggerFormFieldFocusedAction(formFieldElement);
  }

  /**
   * Sets up and memoizes the form field focus event handler.
   *
   * @param formFieldElement - The form field element that triggered the focus event.
   */
  private handleFormFieldFocusEvent = (formFieldElement: ElementWithOpId<FormFieldElement>) => {
    return this.useEventHandlersMemo(
      () => this.triggerFormFieldFocusedAction(formFieldElement),
      this.getFormFieldHandlerMemoIndex(formFieldElement, EVENTS.FOCUS),
    );
  };

  /**
   * Triggers when the form field element receives a focus event. This method will
   * update the most recently focused field and open the autofill inline menu if the
   * autofill process is not currently active.
   *
   * @param formFieldElement - The form field element that triggered the focus event.
   */
  private async triggerFormFieldFocusedAction(formFieldElement: ElementWithOpId<FormFieldElement>) {
    if (await this.isFieldCurrentlyFilling()) {
      return;
    }

    this.sendPortMessage("updateIsFieldCurrentlyFocused", {
      isFieldCurrentlyFocused: true,
    });
    const initiallyFocusedField = this.mostRecentlyFocusedField;
    await this.updateMostRecentlyFocusedField(formFieldElement);

    if (
      this.inlineMenuVisibility === AutofillOverlayVisibility.OnButtonClick ||
      (initiallyFocusedField !== this.mostRecentlyFocusedField &&
        (await this.hideInlineMenuListOnFilledField(formFieldElement as FillableFormFieldElement)))
    ) {
      this.sendPortMessage("closeAutofillInlineMenu", {
        overlayElement: AutofillOverlayElement.List,
        forceCloseInlineMenu: true,
      });
    }

    if (await this.hideInlineMenuListOnFilledField(formFieldElement as FillableFormFieldElement)) {
      this.updateInlineMenuButtonPosition();
      return;
    }

    this.sendPortMessage("openAutofillInlineMenu");
  }

  /**
   * Validates whether the user is currently authenticated.
   */
  private isUserAuthed() {
    return this.authStatus === AuthenticationStatus.Unlocked;
  }

  /**
   * Validates that the most recently focused field is currently
   * focused within the root node relative to the field.
   */
  private recentlyFocusedFieldIsCurrentlyFocused() {
    return (
      this.getRootNodeActiveElement(this.mostRecentlyFocusedField) === this.mostRecentlyFocusedField
    );
  }

  /**
   * Updates the position of both the inline menu button and list.
   */
  private updateInlineMenuElementsPosition() {
    this.updateInlineMenuButtonPosition();
    this.updateInlineMenuListPosition();
  }

  /**
   * Updates the position of the inline menu button.
   */
  private updateInlineMenuButtonPosition() {
    this.sendPortMessage("updateAutofillInlineMenuPosition", {
      overlayElement: AutofillOverlayElement.Button,
    });
  }

  /**
   * Updates the position of the inline menu list.
   */
  private updateInlineMenuListPosition() {
    this.sendPortMessage("updateAutofillInlineMenuPosition", {
      overlayElement: AutofillOverlayElement.List,
    });
  }

  /**
   * Sends a message that facilitates hiding the inline menu elements.
   *
   * @param isHidden - Indicates if the inline menu elements should be hidden.
   * @param setTransparentInlineMenu - Indicates if the inline menu is closing.
   */
  private toggleInlineMenuHidden(isHidden: boolean, setTransparentInlineMenu: boolean = false) {
    void this.sendExtensionMessage("toggleAutofillInlineMenuHidden", {
      isInlineMenuHidden: isHidden,
      setTransparentInlineMenu,
    });
  }

  /**
   * Updates the data used to position the inline menu elements in relation
   * to the most recently focused form field.
   *
   * @param formFieldElement - The form field element that triggered the focus event.
   */
  private async updateMostRecentlyFocusedField(
    formFieldElement: ElementWithOpId<FormFieldElement>,
  ) {
    if (!formFieldElement || !elementIsFillableFormField(formFieldElement)) {
      return;
    }

    this.mostRecentlyFocusedField = formFieldElement;
    const { paddingRight, paddingLeft } = globalThis.getComputedStyle(formFieldElement);
    const { width, height, top, left } =
      await this.getMostRecentlyFocusedFieldRects(formFieldElement);
    this.focusedFieldData = {
      focusedFieldStyles: { paddingRight, paddingLeft },
      focusedFieldRects: { width, height, top, left },
    };

    this.sendPortMessage("updateFocusedFieldData", {
      focusedFieldData: this.focusedFieldData,
    });
  }

  /**
   * Gets the bounding client rects for the most recently focused field. This method will
   * attempt to use an intersection observer to get the most recently focused field's
   * bounding client rects. If the intersection observer is not supported, or the
   * intersection observer does not return a valid bounding client rect, the form
   * field element's bounding client rect will be used.
   *
   * @param formFieldElement - The form field element that triggered the focus event.
   */
  private async getMostRecentlyFocusedFieldRects(
    formFieldElement: ElementWithOpId<FormFieldElement>,
  ) {
    const focusedFieldRects =
      await this.getBoundingClientRectFromIntersectionObserver(formFieldElement);
    if (focusedFieldRects) {
      return focusedFieldRects;
    }

    return formFieldElement.getBoundingClientRect();
  }

  /**
   * Gets the bounds of the form field element from the IntersectionObserver API.
   *
   * @param formFieldElement - The form field element that triggered the focus event.
   */
  private async getBoundingClientRectFromIntersectionObserver(
    formFieldElement: ElementWithOpId<FormFieldElement>,
  ): Promise<DOMRectReadOnly | null> {
    if (!("IntersectionObserver" in globalThis) && !("IntersectionObserverEntry" in globalThis)) {
      return null;
    }

    return new Promise((resolve) => {
      const intersectionObserver = new IntersectionObserver(
        (entries) => {
          let fieldBoundingClientRects = entries[0]?.boundingClientRect;
          if (!fieldBoundingClientRects?.width || !fieldBoundingClientRects.height) {
            fieldBoundingClientRects = null;
          }

          intersectionObserver.disconnect();
          resolve(fieldBoundingClientRects);
        },
        {
          root: globalThis.document.body,
          rootMargin: "0px",
          threshold: 0.9999, // Safari doesn't seem to function properly with a threshold of 1
        },
      );
      intersectionObserver.observe(formFieldElement);
    });
  }

  /**
   * Identifies if the field should have the autofill inline menu setup on it. Currently, this is mainly
   * determined by whether the field correlates with a login cipher. This method will need to be
   * updated in the future to support other types of forms.
   *
   * @param autofillFieldData - Autofill field data captured from the form field element.
   * @param pageDetails - The collected page details from the tab.
   */
  private isIgnoredField(
    autofillFieldData: AutofillField,
    pageDetails: AutofillPageDetails,
  ): boolean {
    if (this.ignoredFieldTypes.has(autofillFieldData.type)) {
      return true;
    }

    return !this.inlineMenuFieldQualificationService.isFieldForLoginForm(
      autofillFieldData,
      pageDetails,
    );
  }

  /**
   * Validates whether a field is considered to be "hidden" based on the field's attributes.
   * If the field is hidden, a fallback listener will be set up to ensure that the
   * field will have the inline menu set up on it when it becomes visible.
   *
   * @param formFieldElement - The form field element that triggered the focus event.
   * @param autofillFieldData - Autofill field data captured from the form field element.
   */
  private isHiddenField(
    formFieldElement: ElementWithOpId<FormFieldElement>,
    autofillFieldData: AutofillField,
  ): boolean {
    if (!autofillFieldData.readonly && !autofillFieldData.disabled && autofillFieldData.viewable) {
      this.removeHiddenFieldFallbackListener(formFieldElement);
      return false;
    }

    this.setupHiddenFieldFallbackListener(formFieldElement, autofillFieldData);
    return true;
  }

  /**
   * Sets up a fallback listener that will facilitate setting up the
   * inline menu on the field when it becomes visible and focused.
   *
   * @param formFieldElement - The form field element that triggered the focus event.
   * @param autofillFieldData - Autofill field data captured from the form field element.
   */
  private setupHiddenFieldFallbackListener(
    formFieldElement: ElementWithOpId<FormFieldElement>,
    autofillFieldData: AutofillField,
  ) {
    this.hiddenFormFieldElements.set(formFieldElement, autofillFieldData);
    formFieldElement.addEventListener(EVENTS.FOCUS, this.handleHiddenFieldFocusEvent);
  }

  /**
   * Removes the fallback listener that facilitates setting up the inline
   *  menu on the field when it becomes visible and focused.
   *
   * @param formFieldElement - The form field element that triggered the focus event.
   */
  private removeHiddenFieldFallbackListener(formFieldElement: ElementWithOpId<FormFieldElement>) {
    formFieldElement.removeEventListener(EVENTS.FOCUS, this.handleHiddenFieldFocusEvent);
    this.hiddenFormFieldElements.delete(formFieldElement);
  }

  /**
   * Handles the focus event on a hidden field. When
   * triggered, the inline menu is set up on the field.
   *
   * @param event - The focus event.
   */
  private handleHiddenFieldFocusEvent = (event: FocusEvent) => {
    const formFieldElement = event.target as ElementWithOpId<FormFieldElement>;
    const autofillFieldData = this.hiddenFormFieldElements.get(formFieldElement);
    if (autofillFieldData) {
      autofillFieldData.readonly = getAttributeBoolean(formFieldElement, "disabled");
      autofillFieldData.disabled = getAttributeBoolean(formFieldElement, "disabled");
      autofillFieldData.viewable = true;
      void this.setupInlineMenuOnQualifiedField(formFieldElement);
    }

    this.removeHiddenFieldFallbackListener(formFieldElement);
  };

  /**
   * Queries the background script for the autofill inline menu visibility setting.
   * If the setting is not found, a default value of OnFieldFocus will be used
   * @private
   */
  private async getInlineMenuVisibility() {
    const inlineMenuVisibility = await this.sendExtensionMessage("getAutofillInlineMenuVisibility");
    this.inlineMenuVisibility = inlineMenuVisibility || AutofillOverlayVisibility.OnFieldFocus;
  }

  /**
   * Returns a value that indicates if we should hide the inline menu list due to a filled field.
   *
   * @param formFieldElement - The form field element that triggered the focus event.
   */
  private async hideInlineMenuListOnFilledField(
    formFieldElement?: FillableFormFieldElement,
  ): Promise<boolean> {
    return (
      formFieldElement?.value &&
      ((await this.isInlineMenuCiphersPopulated()) || !this.isUserAuthed())
    );
  }

  /**
   * Indicates whether the most recently focused field has a value.
   */
  private mostRecentlyFocusedFieldHasValue() {
    return Boolean((this.mostRecentlyFocusedField as FillableFormFieldElement)?.value);
  }

  /**
   * Updates the local reference to the inline menu visibility setting.
   *
   * @param data - The data object from the extension message.
   */
  private updateInlineMenuVisibility({ data }: AutofillExtensionMessage) {
    if (!isNaN(data?.inlineMenuVisibility)) {
      this.inlineMenuVisibility = data.inlineMenuVisibility;
    }
  }

  /**
   * Checks if a field is currently filling within an frame in the tab.
   */
  private async isFieldCurrentlyFilling() {
    return (await this.sendExtensionMessage("checkIsFieldCurrentlyFilling")) === true;
  }

  /**
   * Checks if the inline menu button is visible at the top frame.
   */
  private async isInlineMenuButtonVisible() {
    return (await this.sendExtensionMessage("checkIsAutofillInlineMenuButtonVisible")) === true;
  }

  /**
   * Checks if the inline menu list if visible at the top frame.
   */
  private async isInlineMenuListVisible() {
    return (await this.sendExtensionMessage("checkIsAutofillInlineMenuListVisible")) === true;
  }

  /**
   * Checks if the current tab contains ciphers that can be used to populate the inline menu.
   */
  private async isInlineMenuCiphersPopulated() {
    return (await this.sendExtensionMessage("checkIsInlineMenuCiphersPopulated")) === true;
  }

  /**
   * Triggers a validation to ensure that the inline menu is repositioned only when the
   * current frame contains the focused field at any given depth level.
   */
  private async checkShouldRepositionInlineMenu() {
    return (await this.sendExtensionMessage("checkShouldRepositionInlineMenu")) === true;
  }

  /**
   * Gets the root node of the passed element and returns the active element within that root node.
   *
   * @param element - The element to get the root node active element for.
   */
  private getRootNodeActiveElement(element: Element): Element {
    if (!element) {
      return null;
    }

    const documentRoot = element.getRootNode() as ShadowRoot | Document;
    return documentRoot?.activeElement;
  }

  /**
   * Queries all iframe elements within the document and returns the
   * sub frame offsets for each iframe element.
   *
   * @param message - The message object from the extension.
   */
  private async getSubFrameOffsets(
    message: AutofillExtensionMessage,
  ): Promise<SubFrameOffsetData | null> {
    const { subFrameUrl } = message;
    const subFrameUrlWithoutTrailingSlash = subFrameUrl?.replace(/\/$/, "");

    let iframeElement: HTMLIFrameElement | null = null;
    const iframeElements = globalThis.document.querySelectorAll(
      `iframe[src="${subFrameUrl}"], iframe[src="${subFrameUrlWithoutTrailingSlash}"]`,
    ) as NodeListOf<HTMLIFrameElement>;
    if (iframeElements.length === 1) {
      iframeElement = iframeElements[0];
    }

    if (!iframeElement) {
      return null;
    }

    return this.calculateSubFrameOffsets(iframeElement, subFrameUrl);
  }

  /**
   * Posts a message to the parent frame to calculate the sub frame offset of the current frame.
   *
   * @param message - The message object from the extension.
   */
  private getSubFrameOffsetsFromWindowMessage(message: any) {
    globalThis.parent.postMessage(
      {
        command: "calculateSubFramePositioning",
        subFrameData: {
          url: window.location.href,
          frameId: message.subFrameId,
          left: 0,
          top: 0,
          parentFrameIds: [],
          subFrameDepth: 0,
        } as SubFrameDataFromWindowMessage,
      },
      "*",
    );
  }

  /**
   * Calculates the bounding rect for the queried frame and returns the
   * offset data for the sub frame.
   *
   * @param iframeElement - The iframe element to calculate the sub frame offsets for.
   * @param subFrameUrl - The URL of the sub frame.
   * @param frameId - The frame ID of the sub frame.
   */
  private calculateSubFrameOffsets(
    iframeElement: HTMLIFrameElement,
    subFrameUrl?: string,
    frameId?: number,
  ): SubFrameOffsetData {
    const iframeRect = iframeElement.getBoundingClientRect();
    const iframeStyles = globalThis.getComputedStyle(iframeElement);
    const paddingLeft = parseInt(iframeStyles.getPropertyValue("padding-left")) || 0;
    const paddingTop = parseInt(iframeStyles.getPropertyValue("padding-top")) || 0;
    const borderWidthLeft = parseInt(iframeStyles.getPropertyValue("border-left-width")) || 0;
    const borderWidthTop = parseInt(iframeStyles.getPropertyValue("border-top-width")) || 0;

    return {
      url: subFrameUrl,
      frameId,
      top: iframeRect.top + paddingTop + borderWidthTop,
      left: iframeRect.left + paddingLeft + borderWidthLeft,
    };
  }

  /**
   * Calculates the sub frame positioning for the current frame
   * through all parent frames until the top frame is reached.
   *
   * @param event - The message event.
   */
  private calculateSubFramePositioning = async (event: MessageEvent) => {
    const subFrameData: SubFrameDataFromWindowMessage = event.data.subFrameData;

    subFrameData.subFrameDepth++;
    if (subFrameData.subFrameDepth >= MAX_SUB_FRAME_DEPTH) {
      void this.sendExtensionMessage("destroyAutofillInlineMenuListeners", { subFrameData });
      return;
    }

    let subFrameOffsets: SubFrameOffsetData;
    const iframes = globalThis.document.querySelectorAll("iframe");
    for (let i = 0; i < iframes.length; i++) {
      if (iframes[i].contentWindow === event.source) {
        const iframeElement = iframes[i];
        subFrameOffsets = this.calculateSubFrameOffsets(
          iframeElement,
          subFrameData.url,
          subFrameData.frameId,
        );

        subFrameData.top += subFrameOffsets.top;
        subFrameData.left += subFrameOffsets.left;

        const parentFrameId = await this.sendExtensionMessage("getCurrentTabFrameId");
        if (typeof parentFrameId !== "undefined") {
          subFrameData.parentFrameIds.push(parentFrameId);
        }

        break;
      }
    }

    if (globalThis.window.self !== globalThis.window.top) {
      globalThis.parent.postMessage({ command: "calculateSubFramePositioning", subFrameData }, "*");
      return;
    }

    void this.sendExtensionMessage("updateSubFrameData", { subFrameData });
  };

  /**
   * Sets up global event listeners and the mutation
   * observer to facilitate required changes to the
   * overlay elements.
   */
  private setupGlobalEventListeners = () => {
    globalThis.addEventListener(EVENTS.MESSAGE, this.handleWindowMessageEvent);
    globalThis.document.addEventListener(EVENTS.VISIBILITYCHANGE, this.handleVisibilityChangeEvent);
    globalThis.addEventListener(EVENTS.FOCUSOUT, this.handleFormFieldBlurEvent);
    this.setOverlayRepositionEventListeners();
  };

  /**
   * Handles window messages that are sent to the current frame. Will trigger a
   * calculation of the sub frame offsets through the parent frame.
   *
   * @param event - The message event.
   */
  private handleWindowMessageEvent = (event: MessageEvent) => {
    if (event.data?.command === "calculateSubFramePositioning") {
      void this.calculateSubFramePositioning(event);
    }
  };

  /**
   * Handles the visibility change event. This method will remove the
   * autofill overlay if the document is not visible.
   */
  private handleVisibilityChangeEvent = () => {
    if (!this.mostRecentlyFocusedField || globalThis.document.visibilityState === "visible") {
      return;
    }

    this.unsetMostRecentlyFocusedField();
    this.sendPortMessage("closeAutofillInlineMenu", {
      forceCloseInlineMenu: true,
    });
  };

  /**
   * Sets up event listeners that facilitate repositioning
   * the overlay elements on scroll or resize.
   */
  private setOverlayRepositionEventListeners() {
    globalThis.addEventListener(
      EVENTS.SCROLL,
      this.useEventHandlersMemo(
        throttle(this.handleOverlayRepositionEvent, 200),
        AUTOFILL_OVERLAY_ON_SCROLL,
      ),
      {
        capture: true,
      },
    );
    globalThis.addEventListener(
      EVENTS.RESIZE,
      this.useEventHandlersMemo(
        throttle(this.handleOverlayRepositionEvent, 200),
        AUTOFILL_OVERLAY_ON_RESIZE,
      ),
    );
  }

  /**
   * Removes the listeners that facilitate repositioning
   * the overlay elements on scroll or resize.
   */
  private removeOverlayRepositionEventListeners() {
    globalThis.removeEventListener(
      EVENTS.SCROLL,
      this.eventHandlersMemo[AUTOFILL_OVERLAY_ON_SCROLL],
      {
        capture: true,
      },
    );
    globalThis.removeEventListener(
      EVENTS.RESIZE,
      this.eventHandlersMemo[AUTOFILL_OVERLAY_ON_RESIZE],
    );

    delete this.eventHandlersMemo[AUTOFILL_OVERLAY_ON_SCROLL];
    delete this.eventHandlersMemo[AUTOFILL_OVERLAY_ON_RESIZE];
  }

  /**
   * Handles the resize or scroll events that enact
   * repositioning of existing overlay elements.
   */
  private handleOverlayRepositionEvent = () => {
    this.sendPortMessage("triggerAutofillOverlayReposition");
  };

  private setupRebuildSubFrameOffsetsListeners = () => {
    if (globalThis.window.top === globalThis.window || this.formFieldElements.size < 1) {
      return;
    }

    globalThis.addEventListener(EVENTS.FOCUS, this.handleSubFrameFocusInEvent);
    globalThis.document.body.addEventListener(EVENTS.MOUSEENTER, this.handleSubFrameFocusInEvent);
  };

  private handleSubFrameFocusInEvent = () => {
    void this.sendExtensionMessage("triggerSubFrameFocusInRebuild");

    globalThis.removeEventListener(EVENTS.FOCUS, this.handleSubFrameFocusInEvent);
    globalThis.document.body.removeEventListener(
      EVENTS.MOUSEENTER,
      this.handleSubFrameFocusInEvent,
    );
    globalThis.addEventListener(EVENTS.BLUR, this.setupRebuildSubFrameOffsetsListeners);
    globalThis.document.body.addEventListener(
      EVENTS.MOUSELEAVE,
      this.setupRebuildSubFrameOffsetsListeners,
    );
  };

  private async checkIsMostRecentlyFocusedFieldWithinViewport() {
    await this.updateMostRecentlyFocusedField(this.mostRecentlyFocusedField);

    return this.isFocusedFieldWithinViewportBounds();
  }

  /**
   * Checks if the focused field is present within the bounds of the viewport.
   * If not present, the inline menu will be closed.
   */
  private isFocusedFieldWithinViewportBounds() {
    const focusedFieldRectsTop = this.focusedFieldData?.focusedFieldRects?.top;
    const focusedFieldRectsBottom =
      focusedFieldRectsTop + this.focusedFieldData?.focusedFieldRects?.height;
    const viewportHeight = globalThis.innerHeight + globalThis.scrollY;
    return (
      focusedFieldRectsTop &&
      focusedFieldRectsTop > 0 &&
      focusedFieldRectsTop < viewportHeight &&
      focusedFieldRectsBottom < viewportHeight
    );
  }

  /**
   * Sends a message through the port to the background script.
   *
   * @param command - The command to send through the port.
   * @param message - The message to send through the port.
   */
  private sendPortMessage(
    command: string,
    message: Omit<AutofillOverlayContentExtensionMessage, "command"> = {},
  ) {
    this.port.postMessage({ command, ...message });
  }

  private clearFocusInlineMenuListTimeout() {
    if (this.focusInlineMenuListTimeout) {
      globalThis.clearTimeout(this.focusInlineMenuListTimeout);
    }
  }

  private clearCloseInlineMenuOnRedirectTimeout() {
    if (this.closeInlineMenuOnRedirectTimeout) {
      globalThis.clearTimeout(this.closeInlineMenuOnRedirectTimeout);
    }
  }

  private clearAllTimeouts() {
    this.clearFocusInlineMenuListTimeout();
    this.clearCloseInlineMenuOnRedirectTimeout();
  }

  /**
   * Destroys the autofill overlay content service. This method will
   * disconnect the mutation observers and remove all event listeners.
   */
  destroy() {
    this.clearAllTimeouts();
    this.formFieldElements.forEach((formFieldElement) => {
      this.removeCachedFormFieldEventListeners(formFieldElement);
      formFieldElement.removeEventListener(EVENTS.BLUR, this.handleFormFieldBlurEvent);
      formFieldElement.removeEventListener(EVENTS.KEYUP, this.handleFormFieldKeyupEvent);
      this.formFieldElements.delete(formFieldElement);
    });
    globalThis.removeEventListener(EVENTS.MESSAGE, this.handleWindowMessageEvent);
    globalThis.document.removeEventListener(
      EVENTS.VISIBILITYCHANGE,
      this.handleVisibilityChangeEvent,
    );
    globalThis.removeEventListener(EVENTS.FOCUSOUT, this.handleFormFieldBlurEvent);
    this.removeOverlayRepositionEventListeners();
  }
}
