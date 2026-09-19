import "reflect-metadata";
import { createApp } from "./app.factory";
import { env } from "./config/env";

async function bootstrap() {
  const app = await createApp({ prefix: "api" });
  await app.listen(env().API_PORT);
}
void bootstrap();
