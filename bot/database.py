"""SQLite 数据库实现

使用 SQLite 进行本地数据存储
"""
import logging
import sqlite3
from datetime import datetime, timedelta
from typing import Optional, Dict, List
from dotenv import load_dotenv
import os

# 加载环境变量
load_dotenv()

logger = logging.getLogger(__name__)


class Database:
    """SQLite 数据库管理类"""

    def __init__(self):
        """初始化数据库连接"""
        self.db_path = os.getenv('SQLITE_DB_PATH', 'tgbot_verify.db')
        logger.info(f"SQLite 数据库初始化: {self.db_path}")
        self.init_database()

    def get_connection(self):
        """获取数据库连接"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def init_database(self):
        """初始化数据库表结构"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            # 用户表
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    user_id INTEGER PRIMARY KEY,
                    username TEXT,
                    full_name TEXT,
                    balance INTEGER DEFAULT 1,
                    is_blocked INTEGER DEFAULT 0,
                    invited_by INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_checkin TIMESTAMP NULL
                )
                """
            )

            # 创建索引
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_username ON users(username)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_invited_by ON users(invited_by)")

            # 邀请记录表
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS invitations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    inviter_id INTEGER NOT NULL,
                    invitee_id INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (inviter_id) REFERENCES users(user_id),
                    FOREIGN KEY (invitee_id) REFERENCES users(user_id)
                )
                """
            )

            cursor.execute("CREATE INDEX IF NOT EXISTS idx_inviter ON invitations(inviter_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_invitee ON invitations(invitee_id)")

            # 验证记录表
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS verifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    verification_type TEXT NOT NULL,
                    verification_url TEXT,
                    verification_id TEXT,
                    status TEXT NOT NULL,
                    result TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(user_id)
                )
                """
            )

            cursor.execute("CREATE INDEX IF NOT EXISTS idx_user_id ON verifications(user_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_type ON verifications(verification_type)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_created ON verifications(created_at)")

            # 卡密表
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS card_keys (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key_code TEXT UNIQUE NOT NULL,
                    balance INTEGER NOT NULL,
                    max_uses INTEGER DEFAULT 1,
                    current_uses INTEGER DEFAULT 0,
                    expire_at TIMESTAMP NULL,
                    created_by INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

            cursor.execute("CREATE INDEX IF NOT EXISTS idx_key_code ON card_keys(key_code)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_created_by ON card_keys(created_by)")

            # 卡密使用记录
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS card_key_usage (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key_code TEXT NOT NULL,
                    user_id INTEGER NOT NULL,
                    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

            cursor.execute("CREATE INDEX IF NOT EXISTS idx_key_code_usage ON card_key_usage(key_code)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_user_id_usage ON card_key_usage(user_id)")

            conn.commit()
            logger.info("SQLite 数据库表初始化完成")

        except Exception as e:
            logger.error(f"初始化数据库失败: {e}")
            conn.rollback()
            raise
        finally:
            cursor.close()
            conn.close()

    def create_user(
        self, user_id: int, username: str, full_name: str, invited_by: Optional[int] = None
    ) -> bool:
        """创建新用户"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute(
                """
                INSERT INTO users (user_id, username, full_name, invited_by, created_at)
                VALUES (?, ?, ?, ?, datetime('now'))
                """,
                (user_id, username, full_name, invited_by),
            )

            if invited_by:
                cursor.execute(
                    "UPDATE users SET balance = balance + 2 WHERE user_id = ?",
                    (invited_by,),
                )

                cursor.execute(
                    """
                    INSERT INTO invitations (inviter_id, invitee_id, created_at)
                    VALUES (?, ?, datetime('now'))
                    """,
                    (invited_by, user_id),
                )

            conn.commit()
            return True

        except sqlite3.IntegrityError:
            conn.rollback()
            return False
        except Exception as e:
            logger.error(f"创建用户失败: {e}")
            conn.rollback()
            return False
        finally:
            cursor.close()
            conn.close()

    def get_user(self, user_id: int) -> Optional[Dict]:
        """获取用户信息"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
            row = cursor.fetchone()

            if row:
                return dict(row)
            return None

        finally:
            cursor.close()
            conn.close()

    def user_exists(self, user_id: int) -> bool:
        """检查用户是否存在"""
        return self.get_user(user_id) is not None

    def is_user_blocked(self, user_id: int) -> bool:
        """检查用户是否被拉黑"""
        user = self.get_user(user_id)
        return user and user['is_blocked'] == 1

    def add_balance(self, user_id: int, amount: int) -> bool:
        """增加用户积分"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute(
                "UPDATE users SET balance = balance + ? WHERE user_id = ?",
                (amount, user_id),
            )
            conn.commit()
            return cursor.rowcount > 0

        except Exception as e:
            logger.error(f"增加积分失败: {e}")
            conn.rollback()
            return False
        finally:
            cursor.close()
            conn.close()

    def deduct_balance(self, user_id: int, amount: int) -> bool:
        """扣除用户积分"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute(
                "UPDATE users SET balance = balance - ? WHERE user_id = ? AND balance >= ?",
                (amount, user_id, amount),
            )
            conn.commit()
            return cursor.rowcount > 0

        except Exception as e:
            logger.error(f"扣除积分失败: {e}")
            conn.rollback()
            return False
        finally:
            cursor.close()
            conn.close()

    def add_verification(
        self,
        user_id: int,
        verification_type: str,
        verification_url: str,
        status: str,
        result: str,
        verification_id: str = None,
    ) -> bool:
        """添加验证记录"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute(
                """
                INSERT INTO verifications
                (user_id, verification_type, verification_url, verification_id, status, result, created_at)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                """,
                (user_id, verification_type, verification_url, verification_id, status, result),
            )
            conn.commit()
            return True

        except Exception as e:
            logger.error(f"添加验证记录失败: {e}")
            conn.rollback()
            return False
        finally:
            cursor.close()
            conn.close()

    def checkin(self, user_id: int, reward: int = 1) -> bool:
        """每日签到"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            # 检查今天是否已签到
            cursor.execute(
                """
                SELECT last_checkin FROM users
                WHERE user_id = ? AND date(last_checkin) = date('now')
                """,
                (user_id,),
            )

            if cursor.fetchone():
                return False  # 今天已签到

            # 更新签到时间和积分
            cursor.execute(
                """
                UPDATE users
                SET last_checkin = datetime('now'), balance = balance + ?
                WHERE user_id = ?
                """,
                (reward, user_id),
            )
            conn.commit()
            return cursor.rowcount > 0

        except Exception as e:
            logger.error(f"签到失败: {e}")
            conn.rollback()
            return False
        finally:
            cursor.close()
            conn.close()

    def get_invitations_count(self, inviter_id: int) -> int:
        """获取用户邀请人数"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute(
                "SELECT COUNT(*) as count FROM invitations WHERE inviter_id = ?",
                (inviter_id,),
            )
            row = cursor.fetchone()
            return row['count'] if row else 0

        finally:
            cursor.close()
            conn.close()

    def block_user(self, user_id: int) -> bool:
        """拉黑用户"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute(
                "UPDATE users SET is_blocked = 1 WHERE user_id = ?",
                (user_id,),
            )
            conn.commit()
            return cursor.rowcount > 0

        finally:
            cursor.close()
            conn.close()

    def unblock_user(self, user_id: int) -> bool:
        """解除拉黑"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute(
                "UPDATE users SET is_blocked = 0 WHERE user_id = ?",
                (user_id,),
            )
            conn.commit()
            return cursor.rowcount > 0

        finally:
            cursor.close()
            conn.close()

    def get_blocked_users(self) -> List[Dict]:
        """获取所有被拉黑的用户"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute("SELECT * FROM users WHERE is_blocked = 1")
            return [dict(row) for row in cursor.fetchall()]

        finally:
            cursor.close()
            conn.close()

    def create_card_key(
        self, key_code: str, balance: int, max_uses: int, expire_at: Optional[datetime], created_by: int
    ) -> bool:
        """创建卡密"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute(
                """
                INSERT INTO card_keys (key_code, balance, max_uses, expire_at, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
                """,
                (key_code, balance, max_uses, expire_at, created_by),
            )
            conn.commit()
            return True

        except sqlite3.IntegrityError:
            conn.rollback()
            return False
        except Exception as e:
            logger.error(f"创建卡密失败: {e}")
            conn.rollback()
            return False
        finally:
            cursor.close()
            conn.close()

    def use_card_key(self, key_code: str, user_id: int) -> Optional[int]:
        """使用卡密，返回获得的积分"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            # 检查卡密
            cursor.execute(
                """
                SELECT * FROM card_keys
                WHERE key_code = ? AND current_uses < max_uses
                AND (expire_at IS NULL OR expire_at > datetime('now'))
                """,
                (key_code,),
            )
            key = cursor.fetchone()

            if not key:
                return None

            # 检查用户是否已使用
            cursor.execute(
                "SELECT * FROM card_key_usage WHERE key_code = ? AND user_id = ?",
                (key_code, user_id),
            )
            if cursor.fetchone():
                return None

            balance = key['balance']

            # 更新卡密使用次数
            cursor.execute(
                "UPDATE card_keys SET current_uses = current_uses + 1 WHERE key_code = ?",
                (key_code,),
            )

            # 记录使用
            cursor.execute(
                "INSERT INTO card_key_usage (key_code, user_id, used_at) VALUES (?, ?, datetime('now'))",
                (key_code, user_id),
            )

            # 增加用户积分
            cursor.execute(
                "UPDATE users SET balance = balance + ? WHERE user_id = ?",
                (balance, user_id),
            )

            conn.commit()
            return balance

        except Exception as e:
            logger.error(f"使用卡密失败: {e}")
            conn.rollback()
            return None
        finally:
            cursor.close()
            conn.close()

    def get_all_card_keys(self) -> List[Dict]:
        """获取所有卡密"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute("SELECT * FROM card_keys ORDER BY created_at DESC")
            return [dict(row) for row in cursor.fetchall()]

        finally:
            cursor.close()
            conn.close()

    def get_all_users(self) -> List[Dict]:
        """获取所有用户"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute("SELECT * FROM users ORDER BY created_at DESC")
            return [dict(row) for row in cursor.fetchall()]

        finally:
            cursor.close()
            conn.close()
