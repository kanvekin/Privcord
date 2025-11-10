# [<img src="./browser/icon.png" width="40" align="left" alt="Kernixcord">](https://github.com/kanvekin/Kernixcord) Kernixcord

[![Privbop]](https://github.com/kanvekin/Privbop)
[![Tests](https://github.com/kanvekin/Kernixcord/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/kanvekin/Kernixcord/actions/workflows/test.yml)
[![Discord](https://img.shields.io/discord/1173279886065029291.svg?color=768AD4&label=Discord&logo=discord&logoColor=white)](https://discord.gg/Kernixcord)

Kernixcord is a fork of [Equicord](https://github.com/Equicord/Equicord), with over 100+ plugins.
You can join our [Discord server](https://discord.gg/Kernixcord) for commits, changes, chatting, or even support.

### Dependencies

[Git](https://git-scm.com/download) and [Node.JS LTS](https://nodejs.dev/en/) are required.

Install `pnpm`:

> :exclamation: This next command may need to be run as admin/root depending on your system, and you may need to close and reopen your terminal for pnpm to be in your PATH.

```shell
npm i -g pnpm
```

> :exclamation: **IMPORTANT** Make sure you aren't using an admin/root terminal from here onwards. It **will** mess up your Discord/Kernixcord instance and you **will** most likely have to reinstall.

Clone Kernixcord:

```shell
git clone https://github.com/kanvekin/Kernixcord
cd Kernixcord
```

Install dependencies:

```shell
pnpm install --frozen-lockfile
```

Build Kernixcord:

```shell
pnpm build
```

Inject Kernixcord into your client:

```shell
pnpm inject
```

## Credits

Vendicated & Vencord & Equicord

## Disclaimer

Discord is trademark of Discord Inc., and solely mentioned for the sake of descriptivity.
Mentioning it does not imply any affiliation with or endorsement by Discord Inc.
Vencord is not connected to Kernixcord and as such, all donation links go to Vendicated's donation link.

<details>
<summary>Using Kernixcord violates Discord's terms of service</summary>

Client modifications are against Discord’s Terms of Service.

However, Discord is pretty indifferent about them and there are no known cases of users getting banned for using client mods! So you should generally be fine if you don’t use plugins that implement abusive behaviour. But no worries, all inbuilt plugins are safe to use!

Regardless, if your account is essential to you and getting disabled would be a disaster for you, you should probably not use any client mods (not exclusive to Kernixcord), just to be safe.

Additionally, make sure not to post screenshots with Kernixcord in a server where you might get banned for it.

</details>
