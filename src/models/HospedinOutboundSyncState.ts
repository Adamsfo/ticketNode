import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { ReservaHospedagem } from './ReservaHospedagem';

export const HospedinOutboundStatus = {
    PENDING_CREATE: 'PENDING_CREATE',
    PENDING_UPDATE: 'PENDING_UPDATE',
    PENDING_CANCEL: 'PENDING_CANCEL',
    PROCESSING: 'PROCESSING',
    SYNCED: 'SYNCED',
    WAIT_RETRY: 'WAIT_RETRY',
    FAILED: 'FAILED',
    BLOCKED: 'BLOCKED',
    ABORTED: 'ABORTED',
} as const;

export type HospedinOutboundStatusValue =
    (typeof HospedinOutboundStatus)[keyof typeof HospedinOutboundStatus];

export const HospedinOutboundDesiredAction = {
    CREATE: 'CREATE',
    UPDATE: 'UPDATE',
    CANCEL: 'CANCEL',
} as const;

export type HospedinOutboundDesiredActionValue =
    (typeof HospedinOutboundDesiredAction)[keyof typeof HospedinOutboundDesiredAction];

interface HospedinOutboundSyncStateAttributes {
    id: number;
    id_reserva_hospedagem: number;
    outbound_status: HospedinOutboundStatusValue | string;
    desired_action: HospedinOutboundDesiredActionValue | string;
    payload_hash: string | null;
    pending_payload_hash: string | null;
    synced_hash_input_json: string | null;
    hospedin_reservation_id: string | null;
    hospedin_guest_id: string | null;
    retry_count: number;
    next_retry_at: Date | null;
    last_error: string | null;
    error_code: string | null;
    last_sync_at: Date | null;
    last_success_at: Date | null;
    processing_started_at: Date | null;
    processing_correlation_id: string | null;
    dirty_at: Date;
    outbound_version: number;
    created_at: Date;
    updated_at: Date;
}

interface HospedinOutboundSyncStateCreationAttributes
    extends Optional<
        HospedinOutboundSyncStateAttributes,
        | 'id'
        | 'outbound_status'
        | 'desired_action'
        | 'payload_hash'
        | 'pending_payload_hash'
        | 'synced_hash_input_json'
        | 'hospedin_reservation_id'
        | 'hospedin_guest_id'
        | 'retry_count'
        | 'next_retry_at'
        | 'last_error'
        | 'error_code'
        | 'last_sync_at'
        | 'last_success_at'
        | 'processing_started_at'
        | 'processing_correlation_id'
        | 'outbound_version'
    > {}

class HospedinOutboundSyncStateModel
    extends Model<
        HospedinOutboundSyncStateAttributes,
        HospedinOutboundSyncStateCreationAttributes
    >
    implements HospedinOutboundSyncStateAttributes
{
    public id!: number;
    public id_reserva_hospedagem!: number;
    public outbound_status!: HospedinOutboundStatusValue | string;
    public desired_action!: HospedinOutboundDesiredActionValue | string;
    public payload_hash!: string | null;
    public pending_payload_hash!: string | null;
    public synced_hash_input_json!: string | null;
    public hospedin_reservation_id!: string | null;
    public hospedin_guest_id!: string | null;
    public retry_count!: number;
    public next_retry_at!: Date | null;
    public last_error!: string | null;
    public error_code!: string | null;
    public last_sync_at!: Date | null;
    public last_success_at!: Date | null;
    public processing_started_at!: Date | null;
    public processing_correlation_id!: string | null;
    public dirty_at!: Date;
    public outbound_version!: number;
    public created_at!: Date;
    public updated_at!: Date;

    static initialize(sequelize: Sequelize) {
        HospedinOutboundSyncStateModel.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                id_reserva_hospedagem: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    unique: true,
                    references: {
                        model: ReservaHospedagem,
                        key: 'id',
                    },
                },
                outbound_status: {
                    type: DataTypes.STRING(32),
                    allowNull: false,
                    defaultValue: HospedinOutboundStatus.PENDING_CREATE,
                },
                desired_action: {
                    type: DataTypes.STRING(16),
                    allowNull: false,
                    defaultValue: HospedinOutboundDesiredAction.CREATE,
                },
                payload_hash: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                },
                pending_payload_hash: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                },
                synced_hash_input_json: {
                    type: DataTypes.TEXT,
                    allowNull: true,
                },
                hospedin_reservation_id: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                },
                hospedin_guest_id: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                },
                retry_count: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    defaultValue: 0,
                },
                next_retry_at: {
                    type: DataTypes.DATE,
                    allowNull: true,
                },
                last_error: {
                    type: DataTypes.TEXT,
                    allowNull: true,
                },
                error_code: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                },
                last_sync_at: {
                    type: DataTypes.DATE,
                    allowNull: true,
                },
                last_success_at: {
                    type: DataTypes.DATE,
                    allowNull: true,
                },
                processing_started_at: {
                    type: DataTypes.DATE,
                    allowNull: true,
                },
                processing_correlation_id: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                },
                dirty_at: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
                outbound_version: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    defaultValue: 0,
                },
                created_at: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
                updated_at: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
            },
            {
                sequelize,
                modelName: 'HospedinOutboundSyncState',
                tableName: 'hospedin_outbound_sync_state',
                freezeTableName: true,
                timestamps: false,
            }
        );
    }

    static associate() {
        HospedinOutboundSyncStateModel.belongsTo(ReservaHospedagem, {
            foreignKey: 'id_reserva_hospedagem',
            as: 'ReservaHospedagem',
        });
        ReservaHospedagem.hasOne(HospedinOutboundSyncStateModel, {
            foreignKey: 'id_reserva_hospedagem',
            as: 'HospedinOutboundSyncState',
        });
    }
}

export const HospedinOutboundSyncStateInit = (sequelize: Sequelize) => {
    HospedinOutboundSyncStateModel.initialize(sequelize);
    HospedinOutboundSyncStateModel.associate();
};

export { HospedinOutboundSyncStateModel as HospedinOutboundSyncState };
