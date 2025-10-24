import express from "express";
import { conn } from "../dbconnect";
import { User } from "../model/user";


import mysql from "mysql2/promise";
import util from "util";

export const queryAsync = util.promisify(conn.query).bind(conn);
export const router = express.Router();

router.get('/',(req,res)=>{
    res.send("Get in login.ts")
});

// -------------------- LOGIN ทั้งผู้ใช้และไรเดอร์ --------------------
router.post("/login", async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) return res.json({ message: "กรอกข้อมูลไม่ครบ" });

    // 1️⃣ ตรวจสอบในตาราง users
    const [userRows] = await conn.query<any[]>("SELECT * FROM users WHERE phone = ?", [phone]);
    const user = userRows.length > 0 ? userRows[0] : null;

    // 2️⃣ ตรวจสอบในตาราง rider
    const [riderRows] = await conn.query<any[]>("SELECT * FROM rider WHERE phone = ?", [phone]);
    const rider = riderRows.length > 0 ? riderRows[0] : null;

    // 3️⃣ วิเคราะห์ผลลัพธ์
    if (user && rider) {
      // ถ้าเจอทั้งสอง
      if (user.password !== password || rider.password !== password)
        return res.json({ message: "รหัสผ่านไม่ถูกต้อง" });

      return res.json({
        message: "เข้าสู่ระบบสำเร็จ",
        status: "dual",
        user,
        rider
      });
    }

    if (user) {
      if (user.password !== password) return res.json({ message: "รหัสผ่านไม่ถูกต้อง" });
      return res.json({ message: "เข้าสู่ระบบสำเร็จ", status: "user", user });
    }

    if (rider) {
      if (rider.password !== password) return res.json({ message: "รหัสผ่านไม่ถูกต้อง" });
      return res.json({ message: "เข้าสู่ระบบสำเร็จ", status: "rider", rider });
    }

    // ถ้าไม่เจอทั้ง 2 ตาราง
    return res.json({ message: "ไม่พบผู้ใช้/ไรเดอร์" });

  } catch (error) {
    console.error("❌ Error in /login:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});