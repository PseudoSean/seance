/**
 * ACCOUNT (`account-notify`) and SETNAME: the user model has no field for
 * either yet, so they are acknowledged silently rather than shown as
 * unhandled noise. Phase D can surface them.
 */

import type {Handler} from "../types";

const ignore: Handler = () => undefined;

export default {ACCOUNT: ignore, SETNAME: ignore};
