import type { RequestHandler } from "express";
import { parseString } from "../../helpers/general.ts";
import { getJSONfromString } from "../../helpers/stringHelpers.ts";
import type { IUpdateQuestRequest } from "../../services/questService.ts";
import { updateQuestKey } from "../../services/questService.ts";
import { getInventory } from "../../services/inventoryService.ts";
import type { IInventoryChanges } from "../../types/purchaseTypes.ts";
import { sendWsBroadcastTo } from "../../services/wsService.ts";

export const updateQuestController: RequestHandler = async (req, res) => {
    const accountId = parseString(req.query.accountId);
    const updateQuestRequest = getJSONfromString<IUpdateQuestRequest>((req.body as string).toString());

    // updates should be made only to one quest key per request
    if (updateQuestRequest.QuestKeys.length > 1) {
        throw new Error(`quest keys array should only have 1 item, but has ${updateQuestRequest.QuestKeys.length}`);
    }

    const inventory = await getInventory(accountId);

    const updateQuestResponse: { CustomData?: string; InventoryChanges?: IInventoryChanges; MissionRewards: [] } = {
        MissionRewards: []
    };
    updateQuestResponse.InventoryChanges = await updateQuestKey(inventory, updateQuestRequest.QuestKeys);

    //TODO: might need to parse the custom data and add the associated items to inventory
    if (updateQuestRequest.QuestKeys[0].CustomData) {
        updateQuestResponse.CustomData = updateQuestRequest.QuestKeys[0].CustomData;
    }

    await inventory.save();
    res.send(updateQuestResponse);
    sendWsBroadcastTo(accountId, { update_inventory: true });
};
