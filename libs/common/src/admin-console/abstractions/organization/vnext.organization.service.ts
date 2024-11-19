import { map, Observable } from "rxjs";

import { I18nService } from "../../../platform/abstractions/i18n.service";
import { Utils } from "../../../platform/misc/utils";
import { UserId } from "../../../types/guid";
import { OrganizationData } from "../../models/data/organization.data";
import { Organization } from "../../models/domain/organization";

export function canAccessVaultTab(org: Organization): boolean {
  return org.canViewAllCollections;
}

export function canAccessSettingsTab(org: Organization): boolean {
  return (
    org.isOwner ||
    org.canManagePolicies ||
    org.canManageSso ||
    org.canManageScim ||
    org.canAccessImportExport ||
    org.canManageDeviceApprovals
  );
}

export function canAccessMembersTab(org: Organization): boolean {
  return org.canManageUsers || org.canManageUsersPassword;
}

export function canAccessGroupsTab(org: Organization): boolean {
  return org.canManageGroups;
}

export function canAccessReportingTab(org: Organization): boolean {
  return org.canAccessReports || org.canAccessEventLogs;
}

export function canAccessBillingTab(org: Organization): boolean {
  return org.isOwner;
}

export function canAccessOrgAdmin(org: Organization): boolean {
  // Admin console can only be accessed by Owners for disabled organizations
  if (!org.enabled && !org.isOwner) {
    return false;
  }
  return (
    canAccessMembersTab(org) ||
    canAccessGroupsTab(org) ||
    canAccessReportingTab(org) ||
    canAccessBillingTab(org) ||
    canAccessSettingsTab(org) ||
    canAccessVaultTab(org)
  );
}

export function getOrganizationById(id: string) {
  return map<Organization[], Organization | undefined>((orgs) => orgs.find((o) => o.id === id));
}

export function canAccessAdmin(i18nService: I18nService) {
  return map<Organization[], Organization[]>((orgs) =>
    orgs.filter(canAccessOrgAdmin).sort(Utils.getSortFunction(i18nService, "name")),
  );
}

export function canAccessImport(i18nService: I18nService) {
  return map<Organization[], Organization[]>((orgs) =>
    orgs
      .filter((org) => org.canAccessImportExport || org.canCreateNewCollections)
      .sort(Utils.getSortFunction(i18nService, "name")),
  );
}

/**
 * Publishes an observable stream of organizations. This service is meant to
 * be used widely across Bitwarden as the primary way of fetching organizations.
 * Risky operations like updates are isolated to the
 * internal extension `InternalOrganizationServiceAbstraction`.
 */
export abstract class vNextOrganizationService {
  /**
   * Publishes state for all organizations under the specified user.
   * @returns An observable list of organizations
   */
  organizations$: (userId: UserId) => Observable<Organization[]>;

  // @todo Clean these up. Continuing to expand them is not recommended.
  // @see https://bitwarden.atlassian.net/browse/AC-2252
  memberOrganizations$: (userId: UserId) => Observable<Organization[]>;
  /**
   * Emits true if the user can create or manage a Free Bitwarden Families sponsorship.
   */
  canManageSponsorships$: (userId: UserId) => Observable<boolean>;
  /**
   * Emits true if any of the user's organizations have a Free Bitwarden Families sponsorship available.
   */
  familySponsorshipAvailable$: (userId: UserId) => Observable<boolean>;
  hasOrganizations: (userId: UserId) => Observable<boolean>;
}

/**
 * Big scary buttons that **update** organization state. These should only be
 * called from within admin-console scoped code. Extends the base
 * `OrganizationService` for easy access to `get` calls.
 * @internal
 */
export abstract class vNextInternalOrganizationServiceAbstraction extends vNextOrganizationService {
  /**
   * Replaces state for the provided organization, or creates it if not found.
   * @param organization The organization state being saved.
   * @param userId The userId to replace state for.
   */
  upsert: (OrganizationData: OrganizationData, userId: UserId) => Promise<void>;

  /**
   * Replaces state for the entire registered organization list for the specified user.
   * You probably don't want this unless you're calling from a full sync
   * operation or a logout. See `upsert` for creating & updating a single
   * organization in the state.
   * @param organizations A complete list of all organization state for the provided
   * user.
   * @param userId The userId to replace state for.
   */
  replace: (organizations: { [id: string]: OrganizationData }, userId: UserId) => Promise<void>;
}