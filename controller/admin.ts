import express from "express";
import { conn } from "../dbconnect"; // ปรับ path ตามโครงสร้างโปรเจกต์ของคุณ
import mysql from "mysql2/promise";
import { ResultSetHeader, RowDataPacket } from "mysql2";

export const router = express.Router();

// --- Endpoint สำหรับลบข้อมูล Users ทั้งหมด ---
router.delete("/users", async (req, res) => {
  let connection: mysql.PoolConnection | undefined;
  console.log("⚠️ Received request to DELETE ALL USERS");

  try {
    connection = await conn.getConnection();
    await connection.beginTransaction();
    console.log("  -> Transaction started");

    // 1. ลบข้อมูลที่เกี่ยวข้องใน address ก่อน (Foreign Key Constraint)
    console.log("  -> Deleting related addresses...");
    await connection.query("DELETE FROM address WHERE user_id IN (SELECT user_id FROM users)");
    console.log("     -> Related addresses deleted.");

    // 2. ลบข้อมูลที่เกี่ยวข้องใน order (ถ้ามี sender_id หรือ receiver_id เป็น user)
    // (ตรวจสอบ Schema ของคุณว่าจำเป็นต้องลบ order ที่เกี่ยวข้องหรือไม่)
    // console.log("  -> Deleting related orders (as sender/receiver)...");
    // await connection.query("DELETE FROM `order` WHERE sender_id IN (SELECT user_id FROM users)");
    // await connection.query("DELETE FROM `order` WHERE receiver_id IN (SELECT user_id FROM users)");
    // console.log("     -> Related orders deleted.");

    // 3. ลบข้อมูลทั้งหมดจากตาราง users
    console.log("  -> Deleting all users...");
    const [deleteResult] = await connection.query<ResultSetHeader>("DELETE FROM users");
    console.log(`     -> ${deleteResult.affectedRows} users deleted.`);

    // 4. รีเซ็ต AUTO_INCREMENT ของตาราง users
    console.log("  -> Resetting users AUTO_INCREMENT...");
    await connection.query("ALTER TABLE users AUTO_INCREMENT = 1");
    console.log("     -> users AUTO_INCREMENT reset.");

    // 5. Commit Transaction
    await connection.commit();
    console.log("  -> Transaction committed");

    res.status(200).json({ message: `ลบข้อมูล Users ทั้งหมด (${deleteResult.affectedRows} รายการ) และรีเซ็ต AUTO_INCREMENT สำเร็จ` });

  } catch (error) {
    console.error("❌ Error deleting users:", error);
    if (connection) {
      console.log("  -> Rolling back transaction...");
      await connection.rollback();
    }
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบข้อมูล Users", error: (error instanceof Error ? error.message : String(error)) });
  } finally {
    if (connection) {
      connection.release();
      console.log("  -> Connection released");
    }
  }
});

// --- Endpoint สำหรับลบข้อมูล Riders ทั้งหมด ---
router.delete("/riders", async (req, res) => {
  let connection: mysql.PoolConnection | undefined;
  console.log("⚠️ Received request to DELETE ALL RIDERS");

  try {
    connection = await conn.getConnection();
    await connection.beginTransaction();
    console.log("  -> Transaction started");

    // 1. ลบข้อมูลที่เกี่ยวข้องใน order (ถ้ามี rider_id)
    // (ตรวจสอบ Schema ของคุณว่าจำเป็นต้องลบ order ที่เกี่ยวข้องหรือไม่)
    // console.log("  -> Deleting related orders (as rider)...");
    // await connection.query("DELETE FROM `order` WHERE rider_id IN (SELECT rider_id FROM rider)");
    // console.log("     -> Related orders deleted.");

    // 2. ลบข้อมูลทั้งหมดจากตาราง rider
    console.log("  -> Deleting all riders...");
    const [deleteResult] = await connection.query<ResultSetHeader>("DELETE FROM rider");
    console.log(`     -> ${deleteResult.affectedRows} riders deleted.`);

    // 3. รีเซ็ต AUTO_INCREMENT ของตาราง rider
    console.log("  -> Resetting rider AUTO_INCREMENT...");
    await connection.query("ALTER TABLE rider AUTO_INCREMENT = 1");
    console.log("     -> rider AUTO_INCREMENT reset.");

    // 4. Commit Transaction
    await connection.commit();
    console.log("  -> Transaction committed");

    res.status(200).json({ message: `ลบข้อมูล Riders ทั้งหมด (${deleteResult.affectedRows} รายการ) และรีเซ็ต AUTO_INCREMENT สำเร็จ` });

  } catch (error) {
    console.error("❌ Error deleting riders:", error);
    if (connection) {
      console.log("  -> Rolling back transaction...");
      await connection.rollback();
    }
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบข้อมูล Riders", error: (error instanceof Error ? error.message : String(error)) });
  } finally {
    if (connection) {
      connection.release();
      console.log("  -> Connection released");
    }
  }
});
