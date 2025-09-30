import type { Request, RequestHandler } from "express";
import { Inbox } from "../../models/inboxModel.ts";
import {
    createMessage,
    deleteAllMessagesRead,
    deleteAllMessagesReadNonCin,
    deleteMessageRead,
    getAllMessagesSorted,
    getMessage,
    type IMessageCreationTemplate
} from "../../services/inboxService.ts";
import { getAccountForRequest, getAccountFromSuffixedName, getSuffixedName } from "../../services/loginService.ts";
import {
    addItems,
    combineInventoryChanges,
    getEffectiveAvatarImageType,
    getInventory,
    updateCurrency
} from "../../services/inventoryService.ts";
import { logger } from "../../utils/logger.ts";
import { ExportFlavour } from "warframe-public-export-plus";
import { handleStoreItemAcquisition } from "../../services/purchaseService.ts";
import { fromStoreItem, isStoreItem } from "../../services/itemDataService.ts";
import type { IOid } from "../../types/commonTypes.ts";
import { unixTimesInMs } from "../../constants/timeConstants.ts";
import { config } from "../../services/configService.ts";
import { Types } from "mongoose";

export const inboxController: RequestHandler = async (req, res) => {
    const { deleteId, lastMessage: latestClientMessageId, messageId } = req.query;

    const account = await getAccountForRequest(req);
    const accountId = account._id.toString();

    if (deleteId) {
        if (deleteId === "DeleteAllRead") {
            await deleteAllMessagesRead(accountId);
        } else if (deleteId === "DeleteAllReadNonCin") {
            await deleteAllMessagesReadNonCin(accountId);
        } else {
            await deleteMessageRead(parseOid(deleteId as string));
        }
        res.status(200).end();
    } else if (messageId) {
        const message = await getMessage(parseOid(messageId as string));
        message.r = true;
        await message.save();

        const attachmentItems = message.attVisualOnly ? undefined : message.att;
        const attachmentCountedItems = message.attVisualOnly ? undefined : message.countedAtt;

        if (!attachmentItems && !attachmentCountedItems && !message.gifts) {
            res.status(200).end();
            return;
        }

        const inventory = await getInventory(accountId);
        const inventoryChanges = {};
        if (attachmentItems) {
            await addItems(
                inventory,
                attachmentItems.map(attItem => ({
                    ItemType: isStoreItem(attItem) ? fromStoreItem(attItem) : attItem,
                    ItemCount: 1
                })),
                inventoryChanges
            );
        }
        if (attachmentCountedItems) {
            await addItems(inventory, attachmentCountedItems, inventoryChanges);
        }
        if (message.gifts) {
            const sender = await getAccountFromSuffixedName(message.sndr);
            const recipientName = getSuffixedName(account);
            const giftQuantity = message.arg!.find(x => x.Key == "GIFT_QUANTITY")!.Tag as number;
            for (const gift of message.gifts) {
                combineInventoryChanges(
                    inventoryChanges,
                    (await handleStoreItemAcquisition(gift.GiftType, inventory, giftQuantity)).InventoryChanges
                );
                if (sender) {
                    await createMessage(sender._id, [
                        {
                            sndr: recipientName,
                            msg: "/Lotus/Language/Menu/GiftReceivedConfirmationBody",
                            arg: [
                                {
                                    Key: "RECIPIENT_NAME",
                                    Tag: recipientName
                                },
                                {
                                    Key: "GIFT_TYPE",
                                    Tag: gift.GiftType
                                },
                                {
                                    Key: "GIFT_QUANTITY",
                                    Tag: giftQuantity
                                }
                            ],
                            sub: "/Lotus/Language/Menu/GiftReceivedConfirmationSubject",
                            icon: ExportFlavour[getEffectiveAvatarImageType(inventory)].icon,
                            highPriority: true
                        }
                    ]);
                }
            }
        }
        if (message.RegularCredits) {
            updateCurrency(inventory, -message.RegularCredits, false, inventoryChanges);
        }
        await inventory.save();
        res.json({ InventoryChanges: inventoryChanges });
    } else if (latestClientMessageId) {
        await createNewEventMessages(req);
        const messages = await Inbox.find({ ownerId: accountId }).sort({ date: 1 });

        const latestClientMessage = messages.find(m => m._id.toString() === parseOid(latestClientMessageId as string));

        if (!latestClientMessage) {
            logger.debug(`this should only happen after DeleteAllRead `);
            res.json({ Inbox: messages });
            return;
        }
        const newMessages = messages.filter(m => m.date > latestClientMessage.date);

        if (newMessages.length === 0) {
            res.send("no-new");
            return;
        }

        res.json({ Inbox: newMessages });
    } else {
        //newly created event messages must be newer than account.LatestEventMessageDate
        await createNewEventMessages(req);
        const messages = await getAllMessagesSorted(accountId);
        const inbox = messages.map(m => m.toJSON());
        res.json({ Inbox: inbox });
    }
};

const createNewEventMessages = async (req: Request): Promise<void> => {
    const account = await getAccountForRequest(req);
    const newEventMessages: IMessageCreationTemplate[] = [];

    // Baro
    const baroIndex = Math.trunc((Date.now() - 910800000) / (unixTimesInMs.day * 14));
    const baroStart = baroIndex * (unixTimesInMs.day * 14) + 910800000;
    const baroActualStart = baroStart + unixTimesInMs.day * (config.worldState?.baroAlwaysAvailable ? 0 : 12);
    if (Date.now() >= baroActualStart && account.LatestEventMessageDate.getTime() < baroActualStart) {
        newEventMessages.push({
            sndr: "/Lotus/Language/G1Quests/VoidTraderName",
            sub: "/Lotus/Language/CommunityMessages/VoidTraderAppearanceTitle",
            msg: "/Lotus/Language/CommunityMessages/VoidTraderAppearanceMessage",
            icon: "/Lotus/Interface/Icons/Npcs/BaroKiTeerPortrait.png",
            startDate: new Date(baroActualStart),
            endDate: new Date(baroStart + unixTimesInMs.day * 14),
            CrossPlatform: true,
            arg: [
                {
                    Key: "NODE_NAME",
                    Tag: ["EarthHUB", "MercuryHUB", "SaturnHUB", "PlutoHUB"][baroIndex % 4]
                }
            ],
            date: new Date(baroActualStart)
        });
    }

    // BUG: Deleting the inbox message manually means it'll just be automatically re-created. This is because we don't use startDate/endDate for these config-toggled events.
    const promises = [];
    if (config.worldState?.creditBoost) {
        promises.push(
            (async (): Promise<void> => {
                if (!(await Inbox.exists({ ownerId: account._id, globaUpgradeId: "5b23106f283a555109666672" }))) {
                    newEventMessages.push({
                        globaUpgradeId: new Types.ObjectId("5b23106f283a555109666672"),
                        sndr: "/Lotus/Language/Menu/Mailbox_WarframeSender",
                        sub: "/Lotus/Language/Items/EventDoubleCreditsName",
                        msg: "/Lotus/Language/Items/EventDoubleCreditsDesc",
                        icon: "/Lotus/Interface/Icons/Npcs/Lotus_d.png",
                        startDate: new Date(),
                        CrossPlatform: true
                    });
                }
            })()
        );
    }
    if (config.worldState?.affinityBoost) {
        promises.push(
            (async (): Promise<void> => {
                if (!(await Inbox.exists({ ownerId: account._id, globaUpgradeId: "5b23106f283a555109666673" }))) {
                    newEventMessages.push({
                        globaUpgradeId: new Types.ObjectId("5b23106f283a555109666673"),
                        sndr: "/Lotus/Language/Menu/Mailbox_WarframeSender",
                        sub: "/Lotus/Language/Items/EventDoubleAffinityName",
                        msg: "/Lotus/Language/Items/EventDoubleAffinityDesc",
                        icon: "/Lotus/Interface/Icons/Npcs/Lotus_d.png",
                        startDate: new Date(),
                        CrossPlatform: true
                    });
                }
            })()
        );
    }
    if (config.worldState?.resourceBoost) {
        promises.push(
            (async (): Promise<void> => {
                if (!(await Inbox.exists({ ownerId: account._id, globaUpgradeId: "5b23106f283a555109666674" }))) {
                    newEventMessages.push({
                        globaUpgradeId: new Types.ObjectId("5b23106f283a555109666674"),
                        sndr: "/Lotus/Language/Menu/Mailbox_WarframeSender",
                        sub: "/Lotus/Language/Items/EventDoubleResourceName",
                        msg: "/Lotus/Language/Items/EventDoubleResourceDesc",
                        icon: "/Lotus/Interface/Icons/Npcs/Lotus_d.png",
                        startDate: new Date(),
                        CrossPlatform: true
                    });
                }
            })()
        );
    }
    if (config.worldState?.galleonOfGhouls) {
        promises.push(
            (async (): Promise<void> => {
                if (!(await Inbox.exists({ ownerId: account._id, goalTag: "GalleonRobbery" }))) {
                    newEventMessages.push({
                        sndr: "/Lotus/Language/Bosses/BossCouncilorVayHek",
                        sub: "/Lotus/Language/Events/GalleonRobberyIntroMsgTitle",
                        msg: "/Lotus/Language/Events/GalleonRobberyIntroMsgDesc",
                        icon: "/Lotus/Interface/Icons/Npcs/VayHekPortrait.png",
                        transmission: "/Lotus/Sounds/Dialog/GalleonOfGhouls/DGhoulsWeekOneInbox0010VayHek",
                        att: ["/Lotus/Upgrades/Skins/Events/OgrisOldSchool"],
                        startDate: new Date(),
                        goalTag: "GalleonRobbery"
                    });
                }
            })()
        );
    }
    await Promise.all(promises);

    if (newEventMessages.length === 0) {
        return;
    }

    await createMessage(account._id, newEventMessages);

    const latestEventMessage = newEventMessages.reduce((prev, current) =>
        prev.startDate! > current.startDate! ? prev : current
    );
    account.LatestEventMessageDate = new Date(latestEventMessage.startDate!);
    await account.save();
};

// 33.6.0 has query arguments like lastMessage={"$oid":"68112baebf192e786d1502bb"} instead of lastMessage=68112baebf192e786d1502bb
const parseOid = (oid: string): string => {
    if (oid[0] == "{") {
        return (JSON.parse(oid) as IOid).$oid;
    }
    return oid;
};
