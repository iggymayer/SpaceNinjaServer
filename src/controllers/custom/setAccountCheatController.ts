import { getInventory } from "../../services/inventoryService.ts";
import { getAccountIdForRequest } from "../../services/loginService.ts";
import { sendWsBroadcastTo } from "../../services/wsService.ts";
import type { IAccountCheats } from "../../types/inventoryTypes/inventoryTypes.ts";
import type { RequestHandler } from "express";
import { logger } from "../../utils/logger.ts";

export const setAccountCheatController: RequestHandler = async (req, res) => {
    const accountId = await getAccountIdForRequest(req);
    const payload = req.body as ISetAccountCheatRequest;
    const inventory = await getInventory(accountId, payload.key);

    if (payload.value == undefined) {
        logger.warn(`Aborting setting ${payload.key} as undefined!`);
        return;
    }

    inventory[payload.key] = payload.value as never;
    await inventory.save();
    res.end();
    if (["infiniteCredits", "infinitePlatinum", "infiniteEndo", "infiniteRegalAya"].indexOf(payload.key) != -1) {
        sendWsBroadcastTo(accountId, { update_inventory: true, sync_inventory: true });
    }
};

interface ISetAccountCheatRequest {
    key: keyof IAccountCheats;
    value: IAccountCheats[keyof IAccountCheats];
}
