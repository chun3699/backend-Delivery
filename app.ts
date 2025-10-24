import express from "express";
import { router as login } from "./controller/login";
import { router as register } from "./controller/register";
import { router as user } from "./controller/user";
import { router as rider } from "./controller/rider";
import { router as admin } from "./controller/admin";
import { router as order } from "./controller/order";
import * as os from "os";

export const app = express();

//คำสั่งรันserver: npx nodemon server.ts

// ✅ Middleware สำหรับอ่าน JSON และ urlencoded body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Router
app.use("/", login);
app.use("/register", register);
app.use("/users", user);
app.use("/riders", rider);
app.use("/admin", admin);
app.use("/orders", order);

// หา IP ของเครื่อง
function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

const localIP = getLocalIP();
const PORT = 3000;

// รันเซิฟเวอร์
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Server running at http://${localIP}:${PORT}/`);
});
