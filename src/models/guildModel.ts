import type {
    IGuildDatabase,
    IDojoComponentDatabase,
    ITechProjectDatabase,
    IDojoDecoDatabase,
    ILongMOTD,
    IGuildMemberDatabase,
    IGuildLogEntryNumber,
    IGuildRank,
    IGuildLogRoomChange,
    IGuildLogEntryRoster,
    IGuildLogEntryContributable,
    IDojoLeaderboardEntry,
    IGuildAdDatabase,
    IAllianceDatabase,
    IAllianceMemberDatabase
} from "../types/guildTypes.ts";
import { GuildPermission } from "../types/guildTypes.ts";
import type { Document, Model } from "mongoose";
import { model, Schema, Types } from "mongoose";
import { fusionTreasuresSchema, typeCountSchema } from "./inventoryModels/inventoryModel.ts";
import { pictureFrameInfoSchema } from "./personalRoomsModel.ts";
import type { IGoalProgressClient, IGoalProgressDatabase } from "../types/inventoryTypes/inventoryTypes.ts";
import { toOid } from "../helpers/inventoryHelpers.ts";

const dojoDecoSchema = new Schema<IDojoDecoDatabase>({
    Type: String,
    Pos: [Number],
    Rot: [Number],
    Scale: Number,
    Name: String,
    Sockets: Number,
    RegularCredits: Number,
    MiscItems: { type: [typeCountSchema], default: undefined },
    CompletionTime: Date,
    RushPlatinum: Number,
    PictureFrameInfo: pictureFrameInfoSchema,
    Pending: Boolean
});

const dojoLeaderboardEntrySchema = new Schema<IDojoLeaderboardEntry>(
    {
        s: Number,
        r: Number,
        n: String
    },
    { _id: false }
);

const dojoComponentSchema = new Schema<IDojoComponentDatabase>({
    SortId: Schema.Types.ObjectId,
    pf: { type: String, required: true },
    ppf: String,
    pi: Schema.Types.ObjectId,
    op: String,
    pp: String,
    Name: String,
    Message: String,
    RegularCredits: Number,
    MiscItems: { type: [typeCountSchema], default: undefined },
    CompletionTime: Date,
    CompletionLogPending: Boolean,
    RushPlatinum: Number,
    DestructionTime: Date,
    Decos: [dojoDecoSchema],
    DecoCapacity: Number,
    PaintBot: Schema.Types.ObjectId,
    PendingColors: { type: [Number], default: undefined },
    Colors: { type: [Number], default: undefined },
    PendingLights: { type: [Number], default: undefined },
    Lights: { type: [Number], default: undefined },
    Settings: String,
    Leaderboard: { type: [dojoLeaderboardEntrySchema], default: undefined }
});

const techProjectSchema = new Schema<ITechProjectDatabase>(
    {
        ItemType: String,
        ReqCredits: Number,
        ReqItems: [typeCountSchema],
        State: Number,
        CompletionDate: Date
    },
    { _id: false }
);

const longMOTDSchema = new Schema<ILongMOTD>(
    {
        message: String,
        authorName: String,
        authorGuildName: String
    },
    { _id: false }
);

const guildRankSchema = new Schema<IGuildRank>(
    {
        Name: String,
        Permissions: Number
    },
    { _id: false }
);

const defaultRanks: IGuildRank[] = [
    {
        Name: "/Lotus/Language/Game/Rank_Creator",
        Permissions: 16351
    },
    {
        Name: "/Lotus/Language/Game/Rank_Warlord",
        Permissions: 16351
    },
    {
        Name: "/Lotus/Language/Game/Rank_General",
        Permissions: GuildPermission.Host | 4318
    },
    {
        Name: "/Lotus/Language/Game/Rank_Officer",
        Permissions: GuildPermission.Host | 4314
    },
    {
        Name: "/Lotus/Language/Game/Rank_Leader",
        Permissions: GuildPermission.Host | 4106
    },
    {
        Name: "/Lotus/Language/Game/Rank_Sage",
        Permissions: GuildPermission.Host | 4304
    },
    {
        Name: "/Lotus/Language/Game/Rank_Soldier",
        Permissions: GuildPermission.Host | 4098
    },
    {
        Name: "/Lotus/Language/Game/Rank_Initiate",
        Permissions: GuildPermission.Host | GuildPermission.Fabricator
    },
    {
        Name: "/Lotus/Language/Game/Rank_Utility",
        Permissions: GuildPermission.Host | GuildPermission.Fabricator
    }
];

const guildLogRoomChangeSchema = new Schema<IGuildLogRoomChange>(
    {
        dateTime: Date,
        entryType: Number,
        details: String,
        componentId: Types.ObjectId
    },
    { _id: false }
);

const guildLogEntryContributableSchema = new Schema<IGuildLogEntryContributable>(
    {
        dateTime: Date,
        entryType: Number,
        details: String
    },
    { _id: false }
);

const guildLogEntryRosterSchema = new Schema<IGuildLogEntryRoster>(
    {
        dateTime: Date,
        entryType: Number,
        details: String
    },
    { _id: false }
);

const guildLogEntryNumberSchema = new Schema<IGuildLogEntryNumber>(
    {
        dateTime: Date,
        entryType: Number,
        details: Number
    },
    { _id: false }
);

const goalProgressSchema = new Schema<IGoalProgressDatabase>(
    {
        Count: Number,
        Tag: String,
        goalId: Types.ObjectId
    },
    { _id: false }
);

goalProgressSchema.set("toJSON", {
    virtuals: true,
    transform(_doc, obj: Record<string, any>) {
        const db = obj as IGoalProgressDatabase;
        const client = obj as IGoalProgressClient;

        client._id = toOid(db.goalId);

        delete obj.goalId;
        delete obj.__v;
    }
});

const guildSchema = new Schema<IGuildDatabase>(
    {
        // SNS guild cheats
        noDojoRoomBuildStage: Boolean,
        noDojoDecoBuildStage: Boolean,
        fastDojoRoomDestruction: Boolean,
        noDojoResearchCosts: Boolean,
        noDojoResearchTime: Boolean,
        fastClanAscension: Boolean,

        Name: { type: String, required: true, unique: true },
        MOTD: { type: String, default: "" },
        LongMOTD: { type: longMOTDSchema, default: undefined },
        Ranks: { type: [guildRankSchema], default: defaultRanks },
        TradeTax: { type: Number, default: 0 },
        Tier: { type: Number, default: 1 },
        Emblem: { type: Boolean },
        AutoContributeFromVault: { type: Boolean },
        AllianceId: { type: Types.ObjectId },
        DojoComponents: { type: [dojoComponentSchema], default: [] },
        DojoCapacity: { type: Number, default: 100 },
        DojoEnergy: { type: Number, default: 5 },
        VaultRegularCredits: Number,
        VaultPremiumCredits: Number,
        VaultMiscItems: { type: [typeCountSchema], default: undefined },
        VaultShipDecorations: { type: [typeCountSchema], default: undefined },
        VaultFusionTreasures: { type: [fusionTreasuresSchema], default: undefined },
        VaultDecoRecipes: { type: [typeCountSchema], default: undefined },
        TechProjects: { type: [techProjectSchema], default: undefined },
        ActiveDojoColorResearch: { type: String, default: "" },
        Class: { type: Number, default: 0 },
        XP: { type: Number, default: 0 },
        ClaimedXP: { type: [String], default: undefined },
        CeremonyClass: Number,
        CeremonyContributors: { type: [Types.ObjectId], default: undefined },
        CeremonyResetDate: Date,
        CeremonyEndo: Number,
        RoomChanges: { type: [guildLogRoomChangeSchema], default: undefined },
        TechChanges: { type: [guildLogEntryContributableSchema], default: undefined },
        RosterActivity: { type: [guildLogEntryRosterSchema], default: undefined },
        ClassChanges: { type: [guildLogEntryNumberSchema], default: undefined },
        GoalProgress: { type: [goalProgressSchema], default: undefined }
    },
    { id: false }
);

type GuildDocumentProps = {
    DojoComponents: Types.DocumentArray<IDojoComponentDatabase>;
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type GuildModel = Model<IGuildDatabase, {}, GuildDocumentProps>;

export const Guild = model<IGuildDatabase, GuildModel>("Guild", guildSchema);

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type TGuildDatabaseDocument = Document<unknown, {}, IGuildDatabase> &
    Omit<
        IGuildDatabase & {
            _id: Types.ObjectId;
        } & {
            __v: number;
        },
        keyof GuildDocumentProps
    > &
    GuildDocumentProps;

const guildMemberSchema = new Schema<IGuildMemberDatabase>({
    accountId: Types.ObjectId,
    guildId: Types.ObjectId,
    status: { type: Number, required: true },
    rank: { type: Number, default: 7 },
    RequestMsg: String,
    RequestExpiry: Date,
    RegularCreditsContributed: Number,
    PremiumCreditsContributed: Number,
    MiscItemsContributed: { type: [typeCountSchema], default: undefined },
    ShipDecorationsContributed: { type: [typeCountSchema], default: undefined }
});

guildMemberSchema.index({ accountId: 1, guildId: 1 }, { unique: true });
guildMemberSchema.index({ RequestExpiry: 1 }, { expireAfterSeconds: 0 });

export const GuildMember = model<IGuildMemberDatabase>("GuildMember", guildMemberSchema);

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type TGuildMemberDatabaseDocument = Document<unknown, {}, IGuildMemberDatabase> &
    IGuildMemberDatabase & {
        _id: Types.ObjectId;
        __v: number;
    };

const guildAdSchema = new Schema<IGuildAdDatabase>({
    GuildId: { type: Schema.Types.ObjectId, required: true },
    Emblem: Boolean,
    Expiry: { type: Date, required: true },
    Features: { type: Number, required: true },
    GuildName: { type: String, required: true },
    MemberCount: { type: Number, required: true },
    RecruitMsg: { type: String, required: true },
    Tier: { type: Number, required: true }
});

guildAdSchema.index({ GuildId: 1 }, { unique: true });
guildAdSchema.index({ Expiry: 1 }, { expireAfterSeconds: 0 });

export const GuildAd = model<IGuildAdDatabase>("GuildAd", guildAdSchema);

const allianceSchema = new Schema<IAllianceDatabase>({
    Name: String,
    MOTD: longMOTDSchema,
    LongMOTD: longMOTDSchema,
    Emblem: Boolean,
    VaultRegularCredits: Number
});

allianceSchema.index({ Name: 1 }, { unique: true });

export const Alliance = model<IAllianceDatabase>("Alliance", allianceSchema);

const allianceMemberSchema = new Schema<IAllianceMemberDatabase>({
    allianceId: { type: Schema.Types.ObjectId, required: true },
    guildId: { type: Schema.Types.ObjectId, required: true },
    Pending: { type: Boolean, required: true },
    Permissions: { type: Number, required: true }
});

allianceMemberSchema.index({ allianceId: 1, guildId: 1 }, { unique: true });

export const AllianceMember = model<IAllianceMemberDatabase>("AllianceMember", allianceMemberSchema);
