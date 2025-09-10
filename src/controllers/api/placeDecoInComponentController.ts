import {
    getDojoClient,
    getGuildForRequestEx,
    getVaultMiscItemCount,
    hasAccessToDojo,
    hasGuildPermission,
    processDojoBuildMaterialsGathered,
    scaleRequiredCount
} from "../../services/guildService.ts";
import { getInventory } from "../../services/inventoryService.ts";
import { getAccountIdForRequest } from "../../services/loginService.ts";
import { GuildPermission } from "../../types/guildTypes.ts";
import type { RequestHandler } from "express";
import { Types } from "mongoose";
import { ExportDojoRecipes, ExportResources } from "warframe-public-export-plus";

export const placeDecoInComponentController: RequestHandler = async (req, res) => {
    const accountId = await getAccountIdForRequest(req);
    const inventory = await getInventory(accountId, "GuildId LevelKeys");
    const guild = await getGuildForRequestEx(req, inventory);
    if (!hasAccessToDojo(inventory) || !(await hasGuildPermission(guild, accountId, GuildPermission.Decorator))) {
        res.json({ DojoRequestStatus: -1 });
        return;
    }
    const request = JSON.parse(String(req.body)) as IPlaceDecoInComponentRequest;
    const component = guild.DojoComponents.id(request.ComponentId)!;

    if (component.DecoCapacity === undefined) {
        component.DecoCapacity = Object.values(ExportDojoRecipes.rooms).find(
            x => x.resultType == component.pf
        )!.decoCapacity;
    }

    component.Decos ??= [];
    if (request.MoveId) {
        const deco = component.Decos.find(x => x._id.equals(request.MoveId))!;
        deco.Pos = request.Pos;
        deco.Rot = request.Rot;
        deco.Scale = request.Scale;
    } else {
        const deco =
            component.Decos[
                component.Decos.push({
                    _id: new Types.ObjectId(),
                    Type: request.Type,
                    Pos: request.Pos,
                    Rot: request.Rot,
                    Scale: request.Scale,
                    Name: request.Name,
                    Sockets: request.Sockets
                }) - 1
            ];
        const meta = Object.values(ExportDojoRecipes.decos).find(x => x.resultType == request.Type);
        if (meta) {
            if (meta.capacityCost) {
                component.DecoCapacity -= meta.capacityCost;
            }
        } else {
            const entry = Object.entries(ExportResources).find(arr => arr[1].deco == deco.Type);
            if (!entry) {
                throw new Error(`unknown deco type: ${deco.Type}`);
            }
            const [itemType, meta] = entry;
            if (meta.dojoCapacityCost === undefined) {
                throw new Error(`unknown deco type: ${deco.Type}`);
            }
            component.DecoCapacity -= meta.dojoCapacityCost;
            if (deco.Sockets !== undefined) {
                guild.VaultFusionTreasures!.find(x => x.ItemType == itemType && x.Sockets == deco.Sockets)!.ItemCount -=
                    1;
            } else {
                guild.VaultShipDecorations!.find(x => x.ItemType == itemType)!.ItemCount -= 1;
            }
        }
        if (deco.Type != "/Lotus/Objects/Tenno/Props/TnoPaintBotDojoDeco") {
            if (!meta || (meta.price == 0 && meta.ingredients.length == 0) || guild.noDojoDecoBuildStage) {
                deco.CompletionTime = new Date();
                if (meta) {
                    processDojoBuildMaterialsGathered(guild, meta);
                }
            } else if (
                deco.Type.startsWith("/Lotus/Objects/Tenno/Dojo/NpcPlaceables/") ||
                (guild.AutoContributeFromVault && guild.VaultRegularCredits && guild.VaultMiscItems)
            ) {
                if (!guild.VaultRegularCredits || !guild.VaultMiscItems) {
                    throw new Error(`dojo visitor placed without anything in vault?!`);
                }
                if (guild.VaultRegularCredits >= scaleRequiredCount(guild.Tier, meta.price)) {
                    let enoughMiscItems = true;
                    for (const ingredient of meta.ingredients) {
                        if (
                            getVaultMiscItemCount(guild, ingredient.ItemType) <
                            scaleRequiredCount(guild.Tier, ingredient.ItemCount)
                        ) {
                            enoughMiscItems = false;
                            break;
                        }
                    }
                    if (enoughMiscItems) {
                        guild.VaultRegularCredits -= scaleRequiredCount(guild.Tier, meta.price);
                        deco.RegularCredits = scaleRequiredCount(guild.Tier, meta.price);

                        deco.MiscItems = [];
                        for (const ingredient of meta.ingredients) {
                            guild.VaultMiscItems.find(x => x.ItemType == ingredient.ItemType)!.ItemCount -=
                                scaleRequiredCount(guild.Tier, ingredient.ItemCount);
                            deco.MiscItems.push({
                                ItemType: ingredient.ItemType,
                                ItemCount: scaleRequiredCount(guild.Tier, ingredient.ItemCount)
                            });
                        }

                        deco.CompletionTime = new Date(Date.now() + meta.time * 1000);
                        processDojoBuildMaterialsGathered(guild, meta);
                    }
                }
            }
        }
    }

    await guild.save();
    res.json(await getDojoClient(guild, 0, component._id));
};

interface IPlaceDecoInComponentRequest {
    ComponentId: string;
    Revision: number;
    Type: string;
    Pos: number[];
    Rot: number[];
    Scale?: number;
    Name?: string;
    Sockets?: number;
    MoveId?: string;
    ShipDeco?: boolean;
    VaultDeco?: boolean;
}
