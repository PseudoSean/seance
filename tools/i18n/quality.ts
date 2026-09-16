/**
 * The i18n fill's quality gate: the same degenerate-output rule the app's
 * translation pipeline judges every answer by (`outgoing.ts` `isDegenerate`,
 * wired into `answerError` and the queue's `report`). One rule, two callers:
 * the fill rejects a garbage row at translate time, the sweep empties one it
 * already shipped, and the running app reports a garbage answer as a failed
 * translation instead of rendering it.
 *
 * This module exists so the fill/sweep can import the rule without executing
 * fill.ts (an argv-driven script with side effects).
 */
export {isDegenerate} from "../../client/js/translate/outgoing";
