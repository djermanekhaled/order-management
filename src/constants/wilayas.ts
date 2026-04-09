/**
 * Algeria — 58 wilayas (codes 01–58). Labels use hyphen: `01 - Adrar`.
 * @see {@link ALGERIA_WILAYAS_58} for structured data.
 */
export {
  ALGERIA_WILAYAS_58,
  formatWilayaLabel58,
  parseWilayaCodeFromLabel,
  WILAYAS_58_LABELS,
} from "./algeriaWilayas58";

import { WILAYAS_58_LABELS } from "./algeriaWilayas58";

/** Sidebar / CSV filter: all wilaya labels. */
export const WILAYAS: readonly string[] = WILAYAS_58_LABELS;

export const WILAYA_FILTER_ALL = "__all_wilayas__";
