import { createApp } from "./app.js";
import { config } from "./config.js";
import { assertEncryptionKey } from "./security/crypto.js";
import { startScheduler } from "./scheduler.js";

assertEncryptionKey();
const app = createApp();
app.listen(config.port, () => {
  console.log(`PhD Application Intelligence Assistant API on http://localhost:${config.port}`);
  startScheduler();
});
