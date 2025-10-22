import { PersonalRooms } from "../models/personalRoomsModel.ts";
import { addItem } from "./inventoryService.ts";
import type { IGardeningDatabase, TPersonalRoomsDatabaseDocument } from "../types/personalRoomsTypes.ts";
import { getRandomElement } from "./rngService.ts";
import type { TInventoryDatabaseDocument } from "../models/inventoryModels/inventoryModel.ts";
import { logger } from "../utils/logger.ts";

export const getPersonalRooms = async (
    accountId: string,
    projection?: string
): Promise<TPersonalRoomsDatabaseDocument> => {
    const personalRooms = await PersonalRooms.findOne({ personalRoomsOwnerId: accountId }, projection);

    if (!personalRooms) {
        throw new Error(`personal rooms not found for account ${accountId}`);
    }
    return personalRooms;
};

export const unlockShipFeature = async (inventory: TInventoryDatabaseDocument, shipFeature: string): Promise<void> => {
    const personalRooms = await getPersonalRooms(inventory.accountOwnerId.toString());

    if (personalRooms.Ship.Features.includes(shipFeature)) {
        logger.warn(`ship feature ${shipFeature} already unlocked`);
    } else {
        personalRooms.Ship.Features.push(shipFeature);
        await personalRooms.save();
    }
    const miscItem = inventory.MiscItems.find(x => x.ItemType === shipFeature);
    if (miscItem && miscItem.ItemCount > 0) await addItem(inventory, shipFeature, miscItem.ItemCount * -1);
};

export const createGarden = (): IGardeningDatabase => {
    const plantTypes = [
        "/Lotus/Types/Items/Plants/MiscItems/DuvxDuviriGrowingPlantA",
        "/Lotus/Types/Items/Plants/MiscItems/DuvxDuviriGrowingPlantB",
        "/Lotus/Types/Items/Plants/MiscItems/DuvxDuviriGrowingPlantC",
        "/Lotus/Types/Items/Plants/MiscItems/DuvxDuviriGrowingPlantD",
        "/Lotus/Types/Items/Plants/MiscItems/DuvxDuviriGrowingPlantE",
        "/Lotus/Types/Items/Plants/MiscItems/DuvxDuviriGrowingPlantF"
    ];
    const endTime = new Date((Math.trunc(Date.now() / 1000) + 79200) * 1000); // Plants will take 22 hours to grow
    return {
        Planters: [
            {
                Name: "Garden0",
                Plants: [
                    {
                        PlantType: getRandomElement(plantTypes)!,
                        EndTime: endTime,
                        PlotIndex: 0
                    },
                    {
                        PlantType: getRandomElement(plantTypes)!,
                        EndTime: endTime,
                        PlotIndex: 1
                    }
                ]
            },
            {
                Name: "Garden1",
                Plants: [
                    {
                        PlantType: getRandomElement(plantTypes)!,
                        EndTime: endTime,
                        PlotIndex: 0
                    },
                    {
                        PlantType: getRandomElement(plantTypes)!,
                        EndTime: endTime,
                        PlotIndex: 1
                    }
                ]
            },
            {
                Name: "Garden2",
                Plants: [
                    {
                        PlantType: getRandomElement(plantTypes)!,
                        EndTime: endTime,
                        PlotIndex: 0
                    },
                    {
                        PlantType: getRandomElement(plantTypes)!,
                        EndTime: endTime,
                        PlotIndex: 1
                    }
                ]
            }
        ]
    };
};
