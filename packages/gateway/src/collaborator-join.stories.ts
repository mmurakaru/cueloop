/** The SSH auth surfaces as raw ANSI, for the catalog's SSH section; plain literals so gateway needn't import client's Story type. */

import { renderConnectScreen, renderJoinSplash } from "./collaborator-join";

const SIZE = { width: 80, height: 26 };
const size = { cols: SIZE.width, rows: SIZE.height };
const prompt = {
  verificationUri: "https://github.com/login/device",
  verificationUriComplete: "https://github.com/login/device?user_code=WXYZ-1234",
  userCode: "WXYZ-1234",
};

export const meta = { title: "Collaborator Join" };

export const JoinSplash = { ansi: () => renderJoinSplash(size), size: SIZE };

export const ConnectScreen = { ansi: () => renderConnectScreen(size, prompt, false), size: SIZE };

export const ConnectScreenLinkCopied = {
  ansi: () => renderConnectScreen(size, prompt, true),
  size: SIZE,
};
