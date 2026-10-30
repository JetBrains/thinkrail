import { startBroker } from "./server";

const port = Number.parseInt(process.env.PORT ?? "24243", 10);
const host = process.env.HOST ?? "0.0.0.0";
const running = startBroker({ port, host });
process.stdout.write(`thinkrail relay listening on ${host}:${running.port}\n`);
