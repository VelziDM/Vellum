// The preset list, in display order.
//
// Order matters — it is the order presets appear in the PRESETS & COT tab, and
// newest-first is deliberate. Adding a preset generation means adding a file
// here and one line below; adding a preset to an existing generation means
// editing only that generation's file.

import { modes_prometheus } from "./prometheus.js";

export const modes = [
    ...modes_prometheus,
];
