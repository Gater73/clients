import MainBackground from "../../background/main.background";

import NotificationBackground from "./notification.background";
import OverlayBackground from "./overlay.background";

export default class TabsBackground {
  constructor(
    private main: MainBackground,
    private notificationBackground: NotificationBackground,
    private overlayBackground: OverlayBackground
  ) {}

  private focusedWindowId: number;

  /**
   * Initializes the window and tab listeners.
   */
  async init() {
    if (!chrome.tabs || !chrome.windows) {
      return;
    }

    this.updateCurrentTabData();

    // eslint-disable-next-line
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.command === "unlockCompleted") {
        // TODO - I do not like this implementation, it's flaky and not guaranteed to work. We need to figure a way to handle updating these ciphers on login after the cipher data has been decrypted.
        setTimeout(() => this.updateCurrentTabData(), 1000);
      }
    });

    chrome.windows.onFocusChanged.addListener(this.handleWindowOnFocusChanged);
    chrome.tabs.onActivated.addListener(this.handleTabOnActivated);
    chrome.tabs.onReplaced.addListener(this.handleTabOnReplaced);
    chrome.tabs.onUpdated.addListener(this.handleTabOnUpdated);
    chrome.tabs.onRemoved.addListener(this.handleTabOnRemoved);
  }

  /**
   * Handles the window onFocusChanged event.
   *
   * @param windowId - The ID of the window that was focused.
   */
  private handleWindowOnFocusChanged = async (windowId: number) => {
    if (!windowId) {
      return;
    }

    this.focusedWindowId = windowId;
    await this.updateCurrentTabData();
    this.main.messagingService.send("windowChanged");
  };

  /**
   * Handles the tab onActivated event.
   */
  private handleTabOnActivated = async () => {
    await this.updateCurrentTabData();
    this.main.messagingService.send("tabChanged");
  };

  /**
   * Handles the tab onReplaced event.
   */
  private handleTabOnReplaced = async () => {
    if (this.main.onReplacedRan) {
      return;
    }
    this.main.onReplacedRan = true;

    await this.notificationBackground.checkNotificationQueue();
    await this.updateCurrentTabData();
    this.main.messagingService.send("tabChanged");
  };

  /**
   * Handles the tab onUpdated event.
   *
   * @param tabId - The ID of the tab that was updated.
   * @param changeInfo - The change information.
   * @param tab - The updated tab.
   */
  private handleTabOnUpdated = async (
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab
  ) => {
    const removePageDetailsStatus = new Set(["loading", "unloaded"]);
    if (removePageDetailsStatus.has(changeInfo.status)) {
      this.overlayBackground.removePageDetails(tabId);
    }

    if (this.focusedWindowId && tab.windowId !== this.focusedWindowId) {
      return;
    }

    if (!tab.active) {
      return;
    }

    await this.overlayBackground.updateOverlayCiphers();

    if (this.main.onUpdatedRan) {
      return;
    }
    this.main.onUpdatedRan = true;

    await this.notificationBackground.checkNotificationQueue(tab);
    await this.main.refreshBadge();
    await this.main.refreshMenu();
    this.main.messagingService.send("tabChanged");
  };

  /**
   * Handles the tab onRemoved event.
   *
   * @param tabId - The ID of the tab that was removed.
   */
  private handleTabOnRemoved = async (tabId: number) => {
    this.overlayBackground.removePageDetails(tabId);
  };

  /**
   * Updates the current tab data, refreshing the badge and context menu
   * for the current tab. Also updates the overlay ciphers.
   */
  private updateCurrentTabData = async () => {
    await this.main.refreshBadge();
    await this.main.refreshMenu();
    await this.overlayBackground.updateOverlayCiphers();
  };
}
