import type { RequestHandler } from "express";

import { config, getReflexiveAddress } from "../../services/configService.ts";
import { buildConfig } from "../../services/buildConfigService.ts";

import { Account } from "../../models/loginModel.ts";
import { createAccount, createNonce, getUsernameFromEmail, isCorrectPassword } from "../../services/loginService.ts";
import type { IDatabaseAccountJson, ILoginRequest, ILoginResponse } from "../../types/loginTypes.ts";
import { logger } from "../../utils/logger.ts";
import { version_compare } from "../../helpers/inventoryHelpers.ts";
import { sendWsBroadcastTo } from "../../services/wsService.ts";

export const loginController: RequestHandler = async (request, response) => {
    const loginRequest = JSON.parse(String(request.body)) as ILoginRequest; // parse octet stream of json data to json object

    const account = await Account.findOne({ email: loginRequest.email });

    const buildLabel: string =
        typeof request.query.buildLabel == "string"
            ? request.query.buildLabel.split(" ").join("+")
            : buildConfig.buildLabel;

    const { myAddress, myUrlBase } = getReflexiveAddress(request);

    if (
        !account &&
        ((config.autoCreateAccount && loginRequest.ClientType != "webui") ||
            loginRequest.ClientType == "webui-register")
    ) {
        try {
            const name = await getUsernameFromEmail(loginRequest.email);
            const newAccount = await createAccount({
                email: loginRequest.email,
                password: loginRequest.password,
                DisplayName: name,
                CountryCode: loginRequest.lang?.toUpperCase() ?? "EN",
                ClientType: loginRequest.ClientType,
                Nonce: createNonce(),
                BuildLabel: buildLabel,
                LastLogin: new Date()
            });
            logger.debug("created new account");
            response.json(createLoginResponse(myAddress, myUrlBase, newAccount, buildLabel));
            return;
        } catch (error: unknown) {
            if (error instanceof Error) {
                throw new Error(`error creating account ${error.message}`);
            }
        }
    }

    if (!account) {
        response.status(400).json({ error: "unknown user" });
        return;
    }

    if (!isCorrectPassword(loginRequest.password, account.password)) {
        response.status(400).json({ error: "incorrect login data" });
        return;
    }

    if (account.Nonce && account.ClientType != "webui" && !account.Dropped && !loginRequest.kick) {
        // U17 seems to handle "nonce still set" like a login failure.
        if (version_compare(buildLabel, "2015.12.05.18.07") >= 0) {
            response.status(400).send({ error: "nonce still set" });
            return;
        }
    }

    account.ClientType = loginRequest.ClientType;
    account.Nonce = createNonce();
    account.CountryCode = loginRequest.lang?.toUpperCase() ?? "EN";
    account.BuildLabel = buildLabel;
    account.LastLogin = new Date();
    await account.save();

    sendWsBroadcastTo(account._id.toString(), { nonce_updated: true });

    response.json(createLoginResponse(myAddress, myUrlBase, account.toJSON(), buildLabel));
};

const createLoginResponse = (
    myAddress: string,
    myUrlBase: string,
    account: IDatabaseAccountJson,
    buildLabel: string
): ILoginResponse => {
    const resp: ILoginResponse = {
        id: account.id,
        DisplayName: account.DisplayName,
        CountryCode: account.CountryCode,
        AmazonAuthToken: account.AmazonAuthToken,
        AmazonRefreshToken: account.AmazonRefreshToken,
        Nonce: account.Nonce,
        BuildLabel: buildLabel
    };
    if (version_compare(buildLabel, "2015.02.13.10.41") >= 0) {
        resp.NRS = [myAddress];
    }
    if (version_compare(buildLabel, "2015.05.14.16.29") >= 0) {
        // U17 and up
        resp.IRC = config.myIrcAddresses ?? [myAddress];
    }
    if (version_compare(buildLabel, "2018.11.08.14.45") >= 0) {
        // U24 and up
        resp.ConsentNeeded = account.ConsentNeeded;
        resp.TrackedSettings = account.TrackedSettings;
    }
    if (version_compare(buildLabel, "2019.08.29.20.01") >= 0) {
        // U25.7 and up
        resp.ForceLogoutVersion = account.ForceLogoutVersion;
    }
    if (version_compare(buildLabel, "2019.10.31.22.42") >= 0) {
        // U26 and up
        resp.Groups = [];
    }
    if (version_compare(buildLabel, "2021.04.13.19.58") >= 0) {
        resp.DTLS = 0; // bit 0 enables DTLS. if enabled, additional bits can be set, e.g. bit 2 to enable logging. on live, the value is 99.
    }
    if (version_compare(buildLabel, "2022.04.29.12.53") >= 0) {
        resp.ClientType = account.ClientType;
    }
    if (version_compare(buildLabel, "2022.09.06.19.24") >= 0) {
        resp.CrossPlatformAllowed = account.CrossPlatformAllowed;
        resp.HUB = `${myUrlBase}/api/`;
        resp.MatchmakingBuildId = buildConfig.matchmakingBuildId;
    }
    if (version_compare(buildLabel, "2023.04.25.23.40") >= 0) {
        if (version_compare(buildLabel, "2025.08.26.09.49") >= 0) {
            resp.platformCDNs = [`${myUrlBase}/dynamic/`];
        } else {
            resp.platformCDNs = [`${myUrlBase}/`];
        }
    }
    return resp;
};
