import type { RequestHandler } from "express";
import { getAccountIdForRequest } from "../../services/loginService.ts";
import {
    getInventory,
    addMods,
    addRecipes,
    addMiscItems,
    addConsumables,
    freeUpSlot,
    combineInventoryChanges,
    addCrewShipRawSalvage,
    addFusionPoints,
    addCrewShipFusionPoints,
    addFusionTreasures
} from "../../services/inventoryService.ts";
import { InventorySlot } from "../../types/inventoryTypes/inventoryTypes.ts";
import { ExportDojoRecipes } from "warframe-public-export-plus";
import type { IInventoryChanges } from "../../types/purchaseTypes.ts";
import type { TInventoryDatabaseDocument } from "../../models/inventoryModels/inventoryModel.ts";
import { broadcastInventoryUpdate } from "../../services/wsService.ts";
import { parseFusionTreasure } from "../../helpers/inventoryHelpers.ts";

export const sellController: RequestHandler = async (req, res) => {
    const payload = JSON.parse(String(req.body)) as ISellRequest;
    //console.log(JSON.stringify(payload, null, 2));
    const accountId = await getAccountIdForRequest(req);
    const requiredFields = new Set<keyof TInventoryDatabaseDocument>();
    if (payload.SellCurrency == "SC_RegularCredits") {
        requiredFields.add("RegularCredits");
    } else if (payload.SellCurrency == "SC_FusionPoints") {
        requiredFields.add("FusionPoints");
    } else if (payload.SellCurrency == "SC_CrewShipFusionPoints") {
        requiredFields.add("CrewShipFusionPoints");
    } else {
        requiredFields.add("MiscItems");
    }
    for (const key of Object.keys(payload.Items)) {
        requiredFields.add(key as keyof TInventoryDatabaseDocument);
    }
    if (requiredFields.has("Upgrades")) {
        requiredFields.add("RawUpgrades");
    }
    if (payload.Items.Suits) {
        requiredFields.add(InventorySlot.SUITS);
    }
    if (payload.Items.LongGuns || payload.Items.Pistols || payload.Items.Melee) {
        requiredFields.add(InventorySlot.WEAPONS);
    }
    if (payload.Items.SpaceSuits) {
        requiredFields.add(InventorySlot.SPACESUITS);
    }
    if (payload.Items.SpaceGuns || payload.Items.SpaceMelee) {
        requiredFields.add(InventorySlot.SPACEWEAPONS);
    }
    if (payload.Items.MechSuits) {
        requiredFields.add(InventorySlot.MECHSUITS);
    }
    if (payload.Items.Sentinels || payload.Items.SentinelWeapons || payload.Items.MoaPets) {
        requiredFields.add(InventorySlot.SENTINELS);
    }
    if (payload.Items.OperatorAmps) {
        requiredFields.add(InventorySlot.AMPS);
    }
    if (payload.Items.Hoverboards) {
        requiredFields.add(InventorySlot.SPACESUITS);
    }
    if (payload.Items.CrewMembers) {
        requiredFields.add(InventorySlot.CREWMEMBERS);
    }
    if (payload.Items.CrewShipWeapons || payload.Items.CrewShipWeaponSkins) {
        requiredFields.add(InventorySlot.RJ_COMPONENT_AND_ARMAMENTS);
        requiredFields.add("CrewShipRawSalvage");
        if (payload.Items.CrewShipWeapons) {
            requiredFields.add("CrewShipSalvagedWeapons");
        }
        if (payload.Items.CrewShipWeaponSkins) {
            requiredFields.add("CrewShipSalvagedWeaponSkins");
        }
    }
    if (payload.Items.WeaponSkins) {
        requiredFields.add("WeaponSkins");
    }
    const inventory = await getInventory(accountId, Array.from(requiredFields).join(" "));

    // Give currency
    if (payload.SellCurrency == "SC_RegularCredits") {
        inventory.RegularCredits += payload.SellPrice;
    } else if (payload.SellCurrency == "SC_FusionPoints") {
        addFusionPoints(inventory, payload.SellPrice);
    } else if (payload.SellCurrency == "SC_CrewShipFusionPoints") {
        addCrewShipFusionPoints(inventory, payload.SellPrice);
    } else if (payload.SellCurrency == "SC_PrimeBucks") {
        addMiscItems(inventory, [
            {
                ItemType: "/Lotus/Types/Items/MiscItems/PrimeBucks",
                ItemCount: payload.SellPrice
            }
        ]);
    } else if (payload.SellCurrency == "SC_DistillPoints") {
        addMiscItems(inventory, [
            {
                ItemType: "/Lotus/Types/Items/MiscItems/DistillPoints",
                ItemCount: payload.SellPrice
            }
        ]);
    } else if (payload.SellCurrency == "SC_Resources") {
        // Will add appropriate MiscItems from CrewShipWeapons or CrewShipWeaponSkins
    } else {
        throw new Error("Unknown SellCurrency: " + payload.SellCurrency);
    }

    const inventoryChanges: IInventoryChanges = {};

    // Remove item(s)
    if (payload.Items.Suits) {
        payload.Items.Suits.forEach(sellItem => {
            inventory.Suits.pull({ _id: sellItem.String });
            freeUpSlot(inventory, InventorySlot.SUITS);
        });
    }
    if (payload.Items.LongGuns) {
        payload.Items.LongGuns.forEach(sellItem => {
            inventory.LongGuns.pull({ _id: sellItem.String });
            freeUpSlot(inventory, InventorySlot.WEAPONS);
        });
    }
    if (payload.Items.Pistols) {
        payload.Items.Pistols.forEach(sellItem => {
            inventory.Pistols.pull({ _id: sellItem.String });
            freeUpSlot(inventory, InventorySlot.WEAPONS);
        });
    }
    if (payload.Items.Melee) {
        payload.Items.Melee.forEach(sellItem => {
            inventory.Melee.pull({ _id: sellItem.String });
            freeUpSlot(inventory, InventorySlot.WEAPONS);
        });
    }
    if (payload.Items.SpaceSuits) {
        payload.Items.SpaceSuits.forEach(sellItem => {
            inventory.SpaceSuits.pull({ _id: sellItem.String });
            freeUpSlot(inventory, InventorySlot.SPACESUITS);
        });
    }
    if (payload.Items.SpaceGuns) {
        payload.Items.SpaceGuns.forEach(sellItem => {
            inventory.SpaceGuns.pull({ _id: sellItem.String });
            freeUpSlot(inventory, InventorySlot.SPACEWEAPONS);
        });
    }
    if (payload.Items.SpaceMelee) {
        payload.Items.SpaceMelee.forEach(sellItem => {
            inventory.SpaceMelee.pull({ _id: sellItem.String });
            freeUpSlot(inventory, InventorySlot.SPACEWEAPONS);
        });
    }
    if (payload.Items.MechSuits) {
        payload.Items.MechSuits.forEach(sellItem => {
            inventory.MechSuits.pull({ _id: sellItem.String });
            freeUpSlot(inventory, InventorySlot.MECHSUITS);
        });
    }
    if (payload.Items.Sentinels) {
        payload.Items.Sentinels.forEach(sellItem => {
            inventory.Sentinels.pull({ _id: sellItem.String });
            freeUpSlot(inventory, InventorySlot.SENTINELS);
        });
    }
    if (payload.Items.SentinelWeapons) {
        payload.Items.SentinelWeapons.forEach(sellItem => {
            inventory.SentinelWeapons.pull({ _id: sellItem.String });
            freeUpSlot(inventory, InventorySlot.SENTINELS);
        });
    }
    if (payload.Items.MoaPets) {
        payload.Items.MoaPets.forEach(sellItem => {
            inventory.MoaPets.pull({ _id: sellItem.String });
            freeUpSlot(inventory, InventorySlot.SENTINELS);
        });
    }
    if (payload.Items.OperatorAmps) {
        payload.Items.OperatorAmps.forEach(sellItem => {
            inventory.OperatorAmps.pull({ _id: sellItem.String });
            freeUpSlot(inventory, InventorySlot.AMPS);
        });
    }
    if (payload.Items.Hoverboards) {
        payload.Items.Hoverboards.forEach(sellItem => {
            inventory.Hoverboards.pull({ _id: sellItem.String });
            freeUpSlot(inventory, InventorySlot.SPACESUITS);
        });
    }
    if (payload.Items.Drones) {
        payload.Items.Drones.forEach(sellItem => {
            inventory.Drones.pull({ _id: sellItem.String });
        });
    }
    if (payload.Items.KubrowPetPrints) {
        payload.Items.KubrowPetPrints.forEach(sellItem => {
            inventory.KubrowPetPrints.pull({ _id: sellItem.String });
        });
    }
    if (payload.Items.CrewMembers) {
        payload.Items.CrewMembers.forEach(sellItem => {
            inventory.CrewMembers.pull({ _id: sellItem.String });
            freeUpSlot(inventory, InventorySlot.CREWMEMBERS);
        });
    }
    if (payload.Items.CrewShipWeapons) {
        payload.Items.CrewShipWeapons.forEach(sellItem => {
            if (sellItem.String[0] == "/") {
                addCrewShipRawSalvage(inventory, [
                    {
                        ItemType: sellItem.String,
                        ItemCount: sellItem.Count * -1
                    }
                ]);
            } else {
                const index = inventory.CrewShipWeapons.findIndex(x => x._id.equals(sellItem.String));
                if (index != -1) {
                    if (payload.SellCurrency == "SC_Resources") {
                        refundPartialBuildCosts(inventory, inventory.CrewShipWeapons[index].ItemType, inventoryChanges);
                    }
                    inventory.CrewShipWeapons.splice(index, 1);
                    freeUpSlot(inventory, InventorySlot.RJ_COMPONENT_AND_ARMAMENTS);
                } else {
                    inventory.CrewShipSalvagedWeapons.pull({ _id: sellItem.String });
                }
            }
        });
    }
    if (payload.Items.CrewShipWeaponSkins) {
        payload.Items.CrewShipWeaponSkins.forEach(sellItem => {
            if (sellItem.String[0] == "/") {
                addCrewShipRawSalvage(inventory, [
                    {
                        ItemType: sellItem.String,
                        ItemCount: sellItem.Count * -1
                    }
                ]);
            } else {
                const index = inventory.CrewShipWeaponSkins.findIndex(x => x._id.equals(sellItem.String));
                if (index != -1) {
                    if (payload.SellCurrency == "SC_Resources") {
                        refundPartialBuildCosts(
                            inventory,
                            inventory.CrewShipWeaponSkins[index].ItemType,
                            inventoryChanges
                        );
                    }
                    inventory.CrewShipWeaponSkins.splice(index, 1);
                    freeUpSlot(inventory, InventorySlot.RJ_COMPONENT_AND_ARMAMENTS);
                } else {
                    inventory.CrewShipSalvagedWeaponSkins.pull({ _id: sellItem.String });
                }
            }
        });
    }
    if (payload.Items.Consumables) {
        const consumablesChanges = [];
        for (const sellItem of payload.Items.Consumables) {
            consumablesChanges.push({
                ItemType: sellItem.String,
                ItemCount: sellItem.Count * -1
            });
        }
        addConsumables(inventory, consumablesChanges);
    }
    if (payload.Items.Recipes) {
        const recipeChanges = [];
        for (const sellItem of payload.Items.Recipes) {
            recipeChanges.push({
                ItemType: sellItem.String,
                ItemCount: sellItem.Count * -1
            });
        }
        addRecipes(inventory, recipeChanges);
    }
    if (payload.Items.Upgrades) {
        payload.Items.Upgrades.forEach(sellItem => {
            if (sellItem.Count == 0) {
                inventory.Upgrades.pull({ _id: sellItem.String });
            } else {
                addMods(inventory, [
                    {
                        ItemType: sellItem.String,
                        ItemCount: sellItem.Count * -1
                    }
                ]);
            }
        });
    }
    if (payload.Items.MiscItems) {
        payload.Items.MiscItems.forEach(sellItem => {
            addMiscItems(inventory, [
                {
                    ItemType: sellItem.String,
                    ItemCount: sellItem.Count * -1
                }
            ]);
        });
    }
    if (payload.Items.FusionTreasures) {
        payload.Items.FusionTreasures.forEach(sellItem => {
            addFusionTreasures(inventory, [parseFusionTreasure(sellItem.String, sellItem.Count * -1)]);
        });
    }
    if (payload.Items.WeaponSkins) {
        payload.Items.WeaponSkins.forEach(sellItem => {
            inventory.WeaponSkins.pull({ _id: sellItem.String });
        });
    }

    await inventory.save();
    res.json({
        inventoryChanges: inventoryChanges // "inventoryChanges" for this response instead of the usual "InventoryChanges"
    });
    broadcastInventoryUpdate(req);
};

interface ISellRequest {
    Items: {
        Suits?: ISellItem[];
        LongGuns?: ISellItem[];
        Pistols?: ISellItem[];
        Melee?: ISellItem[];
        Consumables?: ISellItem[];
        Recipes?: ISellItem[];
        Upgrades?: ISellItem[];
        MiscItems?: ISellItem[];
        SpaceSuits?: ISellItem[];
        SpaceGuns?: ISellItem[];
        SpaceMelee?: ISellItem[];
        MechSuits?: ISellItem[];
        Sentinels?: ISellItem[];
        SentinelWeapons?: ISellItem[];
        MoaPets?: ISellItem[];
        OperatorAmps?: ISellItem[];
        Hoverboards?: ISellItem[];
        Drones?: ISellItem[];
        KubrowPetPrints?: ISellItem[];
        CrewMembers?: ISellItem[];
        CrewShipWeapons?: ISellItem[];
        CrewShipWeaponSkins?: ISellItem[];
        FusionTreasures?: ISellItem[];
        WeaponSkins?: ISellItem[]; // SNS specific field
    };
    SellPrice: number;
    SellCurrency:
        | "SC_RegularCredits"
        | "SC_PrimeBucks"
        | "SC_FusionPoints"
        | "SC_DistillPoints"
        | "SC_CrewShipFusionPoints"
        | "SC_Resources"
        | "somethingelsewemightnotknowabout";
    buildLabel: string;
}

interface ISellItem {
    String: string; // oid or uniqueName
    Count: number;
}

const refundPartialBuildCosts = (
    inventory: TInventoryDatabaseDocument,
    itemType: string,
    inventoryChanges: IInventoryChanges
): void => {
    // House versions
    const research = Object.values(ExportDojoRecipes.research).find(x => x.resultType == itemType);
    if (research) {
        const miscItemChanges = research.ingredients.map(x => ({
            ItemType: x.ItemType,
            ItemCount: Math.trunc(x.ItemCount * 0.8)
        }));
        addMiscItems(inventory, miscItemChanges);
        combineInventoryChanges(inventoryChanges, { MiscItems: miscItemChanges });
        return;
    }

    // Sigma versions
    const recipe = Object.values(ExportDojoRecipes.fabrications).find(x => x.resultType == itemType);
    if (recipe) {
        const miscItemChanges = recipe.ingredients.map(x => ({
            ItemType: x.ItemType,
            ItemCount: Math.trunc(x.ItemCount * 0.8)
        }));
        addMiscItems(inventory, miscItemChanges);
        combineInventoryChanges(inventoryChanges, { MiscItems: miscItemChanges });
        return;
    }
};
