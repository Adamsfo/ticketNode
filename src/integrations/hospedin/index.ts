export { hospedinApiClient, HospedinApiClient } from './api/HospedinApiClient';
export {
    getHospedinConfig,
    HOSPEDIN_DEFAULT_API_URL,
} from './constants/config';
export type { HospedinConfig } from './constants/config';
export { HospedinLogger } from './logger/HospedinLogger';
export { HospedinApiError } from './types/errors';
export * from './types';
export * from './interfaces';
export * from './dto';
export * from './mapper';
export type { HospedinAccountSource } from './utils/resolveAccountId';

export {
    getOperationalSyncWindow,
    isWithinOperationalSyncWindow,
    parseHospedinSyncMode,
} from './utils/operationalSyncWindow';
export type {
    HospedinSyncMode,
    OperationalSyncWindow,
} from './utils/operationalSyncWindow';

export {
    HospedinAuthService,
    hospedinAuthService,
} from './services/HospedinAuthService';
export {
    HospedinPlaceService,
    hospedinPlaceService,
} from './services/HospedinPlaceService';
export {
    HospedinGuestService,
    hospedinGuestService,
    enrichReservationDtoWithPrimaryGuest,
    payloadHasNamedGuests,
} from './services/HospedinGuestService';
export type { HospedinGuestDto } from './services/HospedinGuestService';
export {
    HospedinReservationService,
    hospedinReservationService,
} from './services/HospedinReservationService';
export {
    HospedinSyncService,
    hospedinSyncService,
} from './services/HospedinSyncService';
export { hospedinSyncLogService } from './services/HospedinSyncLogService';
export { importHospedinPlaceTypes } from './services/HospedinImportPlaceTypeService';
export { importHospedinPlaces } from './services/HospedinImportPlaceService';
export { importHospedinReservations } from './services/HospedinImportReservationService';
export {
    HospedinReservationValidationService,
    hospedinReservationValidationService,
} from './services/HospedinReservationValidationService';
export {
    IntegrationSyncStateService,
    integrationSyncStateService,
    IntegrationProvider,
    IntegrationEntityType,
    IntegrationSyncStatus,
} from './services/IntegrationSyncStateService';
export {
    HospedinPlaceSuiteMapService,
    hospedinPlaceSuiteMapService,
} from './services/HospedinPlaceSuiteMapService';
export {
    PlaceSuiteResolver,
    placeSuiteResolver,
} from './services/PlaceSuiteResolver';
export type { ResolvedInternalSuite } from './services/PlaceSuiteResolver';
export {
    ReservationCreationService,
    reservationCreationService,
} from './services/ReservationCreationService';
export {
    ReservationOriginEnrichmentService,
    reservationOriginEnrichmentService,
    normalizeCanalVenda,
    INTEGRATION_PROVIDER_HOSPEDIN,
} from './services/ReservationOriginEnrichmentService';
export * from './sync';
export * from './validation';
export * from './pipeline';
export {
    runHospedinConnectivityTest,
    runHospedinConnectivityTestOrThrow,
    HospedinConnectivityTestError,
} from './services/HospedinConnectivityTestService';
export type {
    HospedinConnectivityTestResult,
    HospedinTestStep,
    HospedinTestStepName,
} from './services/HospedinConnectivityTestService';

export {
    guestCpfReconcileService,
    reconcileGuestCpfFromDocuments,
} from './services/GuestCpfReconcileService';
export type {
    GuestCpfReconcileResult,
    GuestCpfReconcileItem,
} from './services/GuestCpfReconcileService';

export { hospedinSyncProvider, HospedinSyncProvider } from './HospedinSyncProvider';

/** @deprecated Não usar no MVP (403). */
export {
    HospedinAccountService,
    hospedinAccountService,
} from './services/HospedinAccountService';
/** @deprecated Não usar no MVP (403). */
export {
    HospedinSaleChannelService,
    hospedinSaleChannelService,
} from './services/HospedinSaleChannelService';
