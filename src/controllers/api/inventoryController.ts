import { RequestHandler } from "express";
import { getAccountForRequest } from "@/src/services/loginService";
import { Inventory, TInventoryDatabaseDocument } from "@/src/models/inventoryModels/inventoryModel";
import { config } from "@/src/services/configService";
import allDialogue from "@/static/fixed_responses/allDialogue.json";
import { ILoadoutDatabase } from "@/src/types/saveLoadoutTypes";
import { IInventoryClient, IShipInventory, equipmentKeys } from "@/src/types/inventoryTypes/inventoryTypes";
import { IPolarity, ArtifactPolarity } from "@/src/types/inventoryTypes/commonInventoryTypes";
import {
    eFaction,
    ExportCustoms,
    ExportFlavour,
    ExportResources,
    ExportVirtuals,
    ICountedItem
} from "warframe-public-export-plus";
import { applyCheatsToInfestedFoundry, handleSubsumeCompletion } from "@/src/services/infestedFoundryService";
import {
    addEmailItem,
    addItem,
    addMiscItems,
    allDailyAffiliationKeys,
    checkCalendarAutoAdvance,
    cleanupInventory,
    createLibraryDailyTask,
    getCalendarProgress
} from "@/src/services/inventoryService";
import { logger } from "@/src/utils/logger";
import { addString, catBreadHash } from "@/src/helpers/stringHelpers";
import { Types } from "mongoose";
import { getNemesisManifest } from "@/src/helpers/nemesisHelpers";
import { getPersonalRooms } from "@/src/services/personalRoomsService";
import { IPersonalRoomsClient } from "@/src/types/personalRoomsTypes";
import { Ship } from "@/src/models/shipModel";
import { toLegacyOid, toOid, version_compare } from "@/src/helpers/inventoryHelpers";
import { Inbox } from "@/src/models/inboxModel";
import { unixTimesInMs } from "@/src/constants/timeConstants";
import { DailyDeal } from "@/src/models/worldStateModel";
import { EquipmentFeatures } from "@/src/types/equipmentTypes";
import { generateRewardSeed } from "@/src/services/rngService";
import { getInvasionByOid, getWorldState } from "@/src/services/worldStateService";
import { createMessage } from "@/src/services/inboxService";

export const inventoryController: RequestHandler = async (request, response) => {
    const account = await getAccountForRequest(request);

    const inventory = await Inventory.findOne({ accountOwnerId: account._id });

    if (!inventory) {
        response.status(400).json({ error: "inventory was undefined" });
        return;
    }

    // Handle daily reset
    if (!inventory.NextRefill || Date.now() >= inventory.NextRefill.getTime()) {
        const today = Math.trunc(Date.now() / 86400000);

        for (const key of allDailyAffiliationKeys) {
            inventory[key] = 16000 + inventory.PlayerLevel * 500;
        }
        inventory.DailyFocus = 250000 + inventory.PlayerLevel * 5000;
        inventory.GiftsRemaining = Math.max(8, inventory.PlayerLevel);
        inventory.TradesRemaining = inventory.PlayerLevel;

        inventory.LibraryAvailableDailyTaskInfo = createLibraryDailyTask();

        if (inventory.NextRefill) {
            const lastLoginDay = Math.trunc(inventory.NextRefill.getTime() / 86400000) - 1;
            const daysPassed = today - lastLoginDay;

            if (config.noArgonCrystalDecay) {
                inventory.FoundToday = undefined;
            } else {
                for (let i = 0; i != daysPassed; ++i) {
                    const numArgonCrystals =
                        inventory.MiscItems.find(x => x.ItemType == "/Lotus/Types/Items/MiscItems/ArgonCrystal")
                            ?.ItemCount ?? 0;
                    if (numArgonCrystals == 0) {
                        break;
                    }
                    const numStableArgonCrystals = Math.min(
                        numArgonCrystals,
                        inventory.FoundToday?.find(x => x.ItemType == "/Lotus/Types/Items/MiscItems/ArgonCrystal")
                            ?.ItemCount ?? 0
                    );
                    const numDecayingArgonCrystals = numArgonCrystals - numStableArgonCrystals;
                    const numDecayingArgonCrystalsToRemove = Math.ceil(numDecayingArgonCrystals / 2);
                    logger.debug(`ticking argon crystals for day ${i + 1} of ${daysPassed}`, {
                        numArgonCrystals,
                        numStableArgonCrystals,
                        numDecayingArgonCrystals,
                        numDecayingArgonCrystalsToRemove
                    });
                    // Remove half of owned decaying argon crystals
                    addMiscItems(inventory, [
                        {
                            ItemType: "/Lotus/Types/Items/MiscItems/ArgonCrystal",
                            ItemCount: numDecayingArgonCrystalsToRemove * -1
                        }
                    ]);
                    // All stable argon crystals are now decaying
                    inventory.FoundToday = undefined;
                }
            }

            if (inventory.UsedDailyDeals.length != 0) {
                if (daysPassed == 1) {
                    const todayAt0Utc = today * 86400000;
                    const darvoIndex = Math.trunc((todayAt0Utc - 25200000) / (26 * unixTimesInMs.hour));
                    const darvoStart = darvoIndex * (26 * unixTimesInMs.hour) + 25200000;
                    const darvoOid =
                        ((darvoStart / 1000) & 0xffffffff).toString(16).padStart(8, "0") + "adc51a72f7324d95";
                    const deal = await DailyDeal.findById(darvoOid);
                    if (deal) {
                        inventory.UsedDailyDeals = inventory.UsedDailyDeals.filter(x => x == deal.StoreItem); // keep only the deal that came into this new day with us
                    } else {
                        inventory.UsedDailyDeals = [];
                    }
                } else {
                    inventory.UsedDailyDeals = [];
                }
            }
        }

        // TODO: Setup CalendarProgress as part of 1999 mission completion?

        const previousYearIteration = inventory.CalendarProgress?.Iteration;

        // We need to do the following to ensure the in-game calendar does not break:
        getCalendarProgress(inventory); // Keep the CalendarProgress up-to-date (at least for the current year iteration) (https://onlyg.it/OpenWF/SpaceNinjaServer/issues/2364)
        checkCalendarAutoAdvance(inventory, getWorldState().KnownCalendarSeasons[0]); // Skip birthday events for characters if we do not have them unlocked yet (https://onlyg.it/OpenWF/SpaceNinjaServer/issues/2424)

        // also handle sending of kiss cinematic at year rollover
        if (
            inventory.CalendarProgress!.Iteration != previousYearIteration &&
            inventory.DialogueHistory &&
            inventory.DialogueHistory.Dialogues
        ) {
            let kalymos = false;
            for (const { dialogueName, kissEmail } of [
                {
                    dialogueName: "/Lotus/Types/Gameplay/1999Wf/Dialogue/ArthurDialogue_rom.dialogue",
                    kissEmail: "/Lotus/Types/Items/EmailItems/ArthurKissEmailItem"
                },
                {
                    dialogueName: "/Lotus/Types/Gameplay/1999Wf/Dialogue/EleanorDialogue_rom.dialogue",
                    kissEmail: "/Lotus/Types/Items/EmailItems/EleanorKissEmailItem"
                },
                {
                    dialogueName: "/Lotus/Types/Gameplay/1999Wf/Dialogue/LettieDialogue_rom.dialogue",
                    kissEmail: "/Lotus/Types/Items/EmailItems/LettieKissEmailItem"
                },
                {
                    dialogueName: "/Lotus/Types/Gameplay/1999Wf/Dialogue/JabirDialogue_rom.dialogue",
                    kissEmail: "/Lotus/Types/Items/EmailItems/AmirKissEmailItem"
                },
                {
                    dialogueName: "/Lotus/Types/Gameplay/1999Wf/Dialogue/AoiDialogue_rom.dialogue",
                    kissEmail: "/Lotus/Types/Items/EmailItems/AoiKissEmailItem"
                },
                {
                    dialogueName: "/Lotus/Types/Gameplay/1999Wf/Dialogue/QuincyDialogue_rom.dialogue",
                    kissEmail: "/Lotus/Types/Items/EmailItems/QuincyKissEmailItem"
                }
            ]) {
                const dialogue = inventory.DialogueHistory.Dialogues.find(x => x.DialogueName == dialogueName);
                if (dialogue) {
                    if (dialogue.Rank == 7) {
                        await addEmailItem(inventory, kissEmail);
                        kalymos = false;
                        break;
                    }
                    if (dialogue.Rank == 6) {
                        kalymos = true;
                    }
                }
            }
            if (kalymos) {
                await addEmailItem(inventory, "/Lotus/Types/Items/EmailItems/KalymosKissEmailItem");
            }
        }

        cleanupInventory(inventory);

        inventory.NextRefill = new Date((today + 1) * 86400000); // tomorrow at 0 UTC
        //await inventory.save();
    }

    if (
        inventory.InfestedFoundry &&
        inventory.InfestedFoundry.AbilityOverrideUnlockCooldown &&
        new Date() >= inventory.InfestedFoundry.AbilityOverrideUnlockCooldown
    ) {
        handleSubsumeCompletion(inventory);
        //await inventory.save();
    }

    for (let i = 0; i != inventory.QualifyingInvasions.length; ) {
        const qi = inventory.QualifyingInvasions[i];
        const invasion = getInvasionByOid(qi.invasionId.toString());
        if (!invasion) {
            logger.debug(`removing QualifyingInvasions entry for unknown invasion: ${qi.invasionId.toString()}`);
            inventory.QualifyingInvasions.splice(i, 1);
            continue;
        }
        if (invasion.Completed) {
            let factionSidedWith: string | undefined;
            let battlePay: ICountedItem[] | undefined;
            if (qi.AttackerScore >= 3) {
                factionSidedWith = invasion.Faction;
                battlePay = invasion.AttackerReward.countedItems;
                logger.debug(`invasion pay from ${factionSidedWith}`, { battlePay });
            } else if (qi.DefenderScore >= 3) {
                factionSidedWith = invasion.DefenderFaction;
                battlePay = invasion.DefenderReward.countedItems;
                logger.debug(`invasion pay from ${factionSidedWith}`, { battlePay });
            }
            if (factionSidedWith) {
                if (battlePay) {
                    // Decoupling rewards from the inbox message because it may delete itself without being read
                    for (const item of battlePay) {
                        await addItem(inventory, item.ItemType, item.ItemCount);
                    }
                    await createMessage(account._id, [
                        {
                            sndr: eFaction.find(x => x.tag == factionSidedWith)?.name ?? factionSidedWith, // TOVERIFY
                            msg: `/Lotus/Language/G1Quests/${factionSidedWith}_InvasionThankyouMessageBody`,
                            sub: `/Lotus/Language/G1Quests/${factionSidedWith}_InvasionThankyouMessageSubject`,
                            countedAtt: battlePay,
                            attVisualOnly: true,
                            icon:
                                factionSidedWith == "FC_GRINEER"
                                    ? "/Lotus/Interface/Icons/Npcs/EliteRifleLancerAvatar.png" // Source: https://www.reddit.com/r/Warframe/comments/1aj4usx/battle_pay_worth_10_plat/, https://www.youtube.com/watch?v=XhNZ6ai6BOY
                                    : "/Lotus/Interface/Icons/Npcs/CrewmanNormal.png", // My best source for this is https://www.youtube.com/watch?v=rxrCCFm73XE around 1:37
                            // TOVERIFY: highPriority?
                            endDate: new Date(Date.now() + 86400_000) // TOVERIFY: This type of inbox message seems to automatically delete itself. We'll just delete it after 24 hours, but it's not clear if this is correct.
                        }
                    ]);
                }
                if (invasion.Faction != "FC_INFESTATION") {
                    // Sided with grineer -> opposed corpus -> send zanuka (harvester)
                    // Sided with corpus -> opposed grineer -> send g3 (death squad)
                    inventory[factionSidedWith != "FC_GRINEER" ? "DeathSquadable" : "Harvestable"] = true;
                    // TOVERIFY: Should this happen earlier?
                    // TOVERIFY: Should this send an (ephemeral) email?
                }
            }
            logger.debug(`removing QualifyingInvasions entry for completed invasion: ${qi.invasionId.toString()}`);
            inventory.QualifyingInvasions.splice(i, 1);
            continue;
        }
        ++i;
    }

    if (inventory.LastInventorySync) {
        const lastSyncDuviriMood = Math.trunc(inventory.LastInventorySync.getTimestamp().getTime() / 7200000);
        const currentDuviriMood = Math.trunc(Date.now() / 7200000);
        if (lastSyncDuviriMood != currentDuviriMood) {
            logger.debug(`refreshing duviri seed`);
            if (!inventory.DuviriInfo) {
                inventory.DuviriInfo = {
                    Seed: generateRewardSeed(),
                    NumCompletions: 0
                };
            } else {
                inventory.DuviriInfo.Seed = generateRewardSeed();
            }
        }
    }
    inventory.LastInventorySync = new Types.ObjectId();
    await inventory.save();

    response.json(
        await getInventoryResponse(inventory, "xpBasedLevelCapDisabled" in request.query, account.BuildLabel)
    );
};

export const getInventoryResponse = async (
    inventory: TInventoryDatabaseDocument,
    xpBasedLevelCapDisabled: boolean,
    buildLabel: string | undefined
): Promise<IInventoryClient> => {
    const [inventoryWithLoadOutPresets, ships, latestMessage] = await Promise.all([
        inventory.populate<{ LoadOutPresets: ILoadoutDatabase }>("LoadOutPresets"),
        Ship.find({ ShipOwnerId: inventory.accountOwnerId }),
        Inbox.findOne({ ownerId: inventory.accountOwnerId }, "_id").sort({ date: -1 })
    ]);
    const inventoryResponse = inventoryWithLoadOutPresets.toJSON<IInventoryClient>();
    inventoryResponse.Ships = ships.map(x => x.toJSON<IShipInventory>());

    // In case mission inventory update added an inbox message, we need to send the Mailbox part so the client knows to refresh it.
    if (latestMessage) {
        inventoryResponse.Mailbox = {
            LastInboxId: toOid(latestMessage._id)
        };
    }

    if (config.infiniteCredits) {
        inventoryResponse.RegularCredits = 999999999;
    }
    if (config.infinitePlatinum) {
        inventoryResponse.PremiumCreditsFree = 0;
        inventoryResponse.PremiumCredits = 999999999;
    }
    if (config.infiniteEndo) {
        inventoryResponse.FusionPoints = 999999999;
    }
    if (config.infiniteRegalAya) {
        inventoryResponse.PrimeTokens = 999999999;
    }

    if (config.skipAllDialogue) {
        inventoryResponse.TauntHistory = [
            {
                node: "TreasureTutorial",
                state: "TS_COMPLETED"
            }
        ];
        for (const str of allDialogue) {
            addString(inventoryResponse.NodeIntrosCompleted, str);
        }
    }

    if (config.unlockAllShipDecorations) {
        inventoryResponse.ShipDecorations = [];
        for (const [uniqueName, item] of Object.entries(ExportResources)) {
            if (item.productCategory == "ShipDecorations") {
                inventoryResponse.ShipDecorations.push({ ItemType: uniqueName, ItemCount: 999_999 });
            }
        }
    }

    if (config.unlockAllFlavourItems) {
        inventoryResponse.FlavourItems = [];
        for (const uniqueName in ExportFlavour) {
            inventoryResponse.FlavourItems.push({ ItemType: uniqueName });
        }
    }

    if (config.unlockAllSkins) {
        const missingWeaponSkins = new Set(Object.keys(ExportCustoms));
        inventoryResponse.WeaponSkins.forEach(x => missingWeaponSkins.delete(x.ItemType));
        for (const uniqueName of missingWeaponSkins) {
            inventoryResponse.WeaponSkins.push({
                ItemId: {
                    $oid: "ca70ca70ca70ca70" + catBreadHash(uniqueName).toString(16).padStart(8, "0")
                },
                ItemType: uniqueName
            });
        }
    }

    if (config.unlockAllCapturaScenes) {
        for (const uniqueName of Object.keys(ExportResources)) {
            if (resourceInheritsFrom(uniqueName, "/Lotus/Types/Items/MiscItems/PhotoboothTile")) {
                inventoryResponse.MiscItems.push({
                    ItemType: uniqueName,
                    ItemCount: 1
                });
            }
        }
    }

    if (typeof config.spoofMasteryRank === "number" && config.spoofMasteryRank >= 0) {
        inventoryResponse.PlayerLevel = config.spoofMasteryRank;
        if (!xpBasedLevelCapDisabled) {
            // This client has not been patched to accept any mastery rank, need to fake the XP.
            inventoryResponse.XPInfo = [];
            let numFrames = getExpRequiredForMr(Math.min(config.spoofMasteryRank, 5030)) / 6000;
            while (numFrames-- > 0) {
                inventoryResponse.XPInfo.push({
                    ItemType: "/Lotus/Powersuits/Mag/Mag",
                    XP: 1_600_000
                });
            }
        }
    }

    if (config.universalPolarityEverywhere) {
        const Polarity: IPolarity[] = [];
        // 12 is needed for necramechs. 15 is needed for plexus/crewshipharness.
        for (let i = 0; i != 15; ++i) {
            Polarity.push({
                Slot: i,
                Value: ArtifactPolarity.Any
            });
        }
        for (const key of equipmentKeys) {
            if (key in inventoryResponse) {
                for (const equipment of inventoryResponse[key]) {
                    equipment.Polarity = Polarity;
                }
            }
        }
    }

    if (config.unlockDoubleCapacityPotatoesEverywhere) {
        for (const key of equipmentKeys) {
            if (key in inventoryResponse) {
                for (const equipment of inventoryResponse[key]) {
                    equipment.Features ??= 0;
                    equipment.Features |= EquipmentFeatures.DOUBLE_CAPACITY;
                }
            }
        }
    }

    if (config.unlockExilusEverywhere) {
        for (const key of equipmentKeys) {
            if (key in inventoryResponse) {
                for (const equipment of inventoryResponse[key]) {
                    equipment.Features ??= 0;
                    equipment.Features |= EquipmentFeatures.UTILITY_SLOT;
                }
            }
        }
    }

    if (config.unlockArcanesEverywhere) {
        for (const key of equipmentKeys) {
            if (key in inventoryResponse) {
                for (const equipment of inventoryResponse[key]) {
                    equipment.Features ??= 0;
                    equipment.Features |= EquipmentFeatures.ARCANE_SLOT;
                }
            }
        }
    }

    if (config.noDailyStandingLimits) {
        const spoofedDailyAffiliation = Math.max(999_999, 16000 + inventoryResponse.PlayerLevel * 500);
        for (const key of allDailyAffiliationKeys) {
            inventoryResponse[key] = spoofedDailyAffiliation;
        }
    }

    if (config.noDailyFocusLimit) {
        inventoryResponse.DailyFocus = Math.max(999_999, 250000 + inventoryResponse.PlayerLevel * 5000);
    }

    if (inventoryResponse.InfestedFoundry) {
        applyCheatsToInfestedFoundry(inventoryResponse.InfestedFoundry);
    }

    // Set 2FA enabled so trading post can be used
    inventoryResponse.HWIDProtectEnabled = true;

    if (buildLabel) {
        // Fix nemesis for older versions
        if (
            inventoryResponse.Nemesis &&
            version_compare(buildLabel, getNemesisManifest(inventoryResponse.Nemesis.manifest).minBuild) < 0
        ) {
            inventoryResponse.Nemesis = undefined;
        }

        if (version_compare(buildLabel, "2018.02.22.14.34") < 0) {
            const personalRoomsDb = await getPersonalRooms(inventory.accountOwnerId.toString());
            const personalRooms = personalRoomsDb.toJSON<IPersonalRoomsClient>();
            inventoryResponse.Ship = personalRooms.Ship;

            if (version_compare(buildLabel, "2016.12.21.19.13") <= 0) {
                // U19.5 and below use $id instead of $oid
                for (const category of equipmentKeys) {
                    for (const item of inventoryResponse[category]) {
                        toLegacyOid(item.ItemId);
                    }
                }
                for (const upgrade of inventoryResponse.Upgrades) {
                    toLegacyOid(upgrade.ItemId);
                }
                if (inventoryResponse.BrandedSuits) {
                    for (const id of inventoryResponse.BrandedSuits) {
                        toLegacyOid(id);
                    }
                }
            }
        }
    }

    if (config.unlockAllProfitTakerStages) {
        inventoryResponse.CompletedJobChains ??= [];
        const EudicoHeists = inventoryResponse.CompletedJobChains.find(x => x.LocationTag == "EudicoHeists");
        if (EudicoHeists) {
            EudicoHeists.Jobs = allEudicoHeistJobs;
        } else {
            inventoryResponse.CompletedJobChains.push({
                LocationTag: "EudicoHeists",
                Jobs: allEudicoHeistJobs
            });
        }
    }

    if (config.unlockAllSimarisResearchEntries) {
        inventoryResponse.LibraryPersonalTarget = undefined;
        inventoryResponse.LibraryPersonalProgress = [
            "/Lotus/Types/Game/Library/Targets/Research1Target",
            "/Lotus/Types/Game/Library/Targets/Research2Target",
            "/Lotus/Types/Game/Library/Targets/Research3Target",
            "/Lotus/Types/Game/Library/Targets/Research4Target",
            "/Lotus/Types/Game/Library/Targets/Research5Target",
            "/Lotus/Types/Game/Library/Targets/Research6Target",
            "/Lotus/Types/Game/Library/Targets/Research7Target"
        ].map(type => ({ TargetType: type, Scans: 10, Completed: true }));
    }

    return inventoryResponse;
};

const allEudicoHeistJobs = [
    "/Lotus/Types/Gameplay/Venus/Jobs/Heists/HeistProfitTakerBountyOne",
    "/Lotus/Types/Gameplay/Venus/Jobs/Heists/HeistProfitTakerBountyTwo",
    "/Lotus/Types/Gameplay/Venus/Jobs/Heists/HeistProfitTakerBountyThree",
    "/Lotus/Types/Gameplay/Venus/Jobs/Heists/HeistProfitTakerBountyFour"
];

const getExpRequiredForMr = (rank: number): number => {
    if (rank <= 30) {
        return 2500 * rank * rank;
    }
    return 2_250_000 + 147_500 * (rank - 30);
};

const resourceInheritsFrom = (resourceName: string, targetName: string): boolean => {
    let parentName = resourceGetParent(resourceName);
    for (; parentName != undefined; parentName = resourceGetParent(parentName)) {
        if (parentName == targetName) {
            return true;
        }
    }
    return false;
};

const resourceGetParent = (resourceName: string): string | undefined => {
    if (resourceName in ExportResources) {
        return ExportResources[resourceName].parentName;
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return ExportVirtuals[resourceName]?.parentName;
};
