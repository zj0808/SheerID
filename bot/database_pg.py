"""PostgreSQL 数据库实现

使用 PostgreSQL 进行数据存储
"""
import logging
from datetime import datetime
from typing import Optional, Dict, List
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
import os

# 加载环境变量
load_dotenv()

logger = logging.getLogger(__name__)


class PostgresDatabase:
    """PostgreSQL 数据库管理类"""

    def __init__(self):
        """初始化数据库连接"""
        self.database_url = os.getenv('DATABASE_URL')
        if not self.database_url:
            raise ValueError("DATABASE_URL 环境变量未设置")
        logger.info(f"PostgreSQL 数据库初始化")
        self.init_database()

    def get_connection(self):
        """获取数据库连接"""
        return psycopg2.connect(self.database_url)

    def init_database(self):
        """初始化数据库表结构"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            # 用户表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    user_id BIGINT PRIMARY KEY,
                    username VARCHAR(255),
                    full_name VARCHAR(255),
                    balance INTEGER DEFAULT 1,
                    is_blocked SMALLINT DEFAULT 0,
                    invited_by BIGINT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_checkin TIMESTAMP NULL
                )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_username ON users(username)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_invited_by ON users(invited_by)")

            # 邀请记录表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS invitations (
                    id SERIAL PRIMARY KEY,
                    inviter_id BIGINT NOT NULL,
                    invitee_id BIGINT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_inviter ON invitations(inviter_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_invitee ON invitations(invitee_id)")

            # 验证记录表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS verifications (
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    verification_type VARCHAR(50) NOT NULL,
                    verification_url TEXT,
                    verification_id VARCHAR(100),
                    status VARCHAR(50) NOT NULL,
                    result TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_user_id ON verifications(user_id)")

            # 卡密表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS card_keys (
                    id SERIAL PRIMARY KEY,
                    key_code VARCHAR(100) UNIQUE NOT NULL,
                    balance INTEGER NOT NULL,
                    max_uses INTEGER DEFAULT 1,
                    current_uses INTEGER DEFAULT 0,
                    expire_at TIMESTAMP NULL,
                    created_by BIGINT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # 卡密使用记录
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS card_key_usage (
                    id SERIAL PRIMARY KEY,
                    key_code VARCHAR(100) NOT NULL,
                    user_id BIGINT NOT NULL,
                    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.commit()
            logger.info("PostgreSQL 数据库表初始化完成")

        except Exception as e:
            logger.error(f"初始化数据库失败: {e}")
            conn.rollback()
            raise
        finally:
            cursor.close()
            conn.close()

    def create_user(self, user_id: int, username: str, full_name: str, invited_by: Optional[int] = None) -> bool:
        """创建新用户"""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "INSERT INTO users (user_id, username, full_name, invited_by) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
                (user_id, username, full_name, invited_by)
            )
            if invited_by and cursor.rowcount > 0:
                cursor.execute("UPDATE users SET balance = balance + 2 WHERE user_id = %s", (invited_by,))
                cursor.execute("INSERT INTO invitations (inviter_id, invitee_id) VALUES (%s, %s)", (invited_by, user_id))
            conn.commit()
            return cursor.rowcount > 0
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
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute("SELECT * FROM users WHERE user_id = %s", (user_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            cursor.close()
            conn.close()

    def user_exists(self, user_id: int) -> bool:
        return self.get_user(user_id) is not None

    def is_user_blocked(self, user_id: int) -> bool:
        user = self.get_user(user_id)
        return user and user['is_blocked'] == 1

    def add_balance(self, user_id: int, amount: int) -> bool:
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("UPDATE users SET balance = balance + %s WHERE user_id = %s", (amount, user_id))
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
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("UPDATE users SET balance = balance - %s WHERE user_id = %s AND balance >= %s", (amount, user_id, amount))
            conn.commit()
            return cursor.rowcount > 0
        except Exception as e:
            logger.error(f"扣除积分失败: {e}")
            conn.rollback()
            return False
        finally:
            cursor.close()
            conn.close()

    def add_verification(self, user_id: int, verification_type: str, verification_url: str, status: str, result: str, verification_id: str = None) -> bool:
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "INSERT INTO verifications (user_id, verification_type, verification_url, verification_id, status, result) VALUES (%s, %s, %s, %s, %s, %s)",
                (user_id, verification_type, verification_url, verification_id, status, result)
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
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT last_checkin FROM users WHERE user_id = %s AND DATE(last_checkin) = CURRENT_DATE", (user_id,))
            if cursor.fetchone():
                return False
            cursor.execute("UPDATE users SET last_checkin = CURRENT_TIMESTAMP, balance = balance + %s WHERE user_id = %s", (reward, user_id))
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
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT COUNT(*) FROM invitations WHERE inviter_id = %s", (inviter_id,))
            row = cursor.fetchone()
            return row[0] if row else 0
        finally:
            cursor.close()
            conn.close()

    def block_user(self, user_id: int) -> bool:
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("UPDATE users SET is_blocked = 1 WHERE user_id = %s", (user_id,))
            conn.commit()
            return cursor.rowcount > 0
        finally:
            cursor.close()
            conn.close()

    def unblock_user(self, user_id: int) -> bool:
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("UPDATE users SET is_blocked = 0 WHERE user_id = %s", (user_id,))
            conn.commit()
            return cursor.rowcount > 0
        finally:
            cursor.close()
            conn.close()

    def get_blocked_users(self) -> List[Dict]:
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute("SELECT * FROM users WHERE is_blocked = 1")
            return [dict(row) for row in cursor.fetchall()]
        finally:
            cursor.close()
            conn.close()

    def create_card_key(self, key_code: str, balance: int, max_uses: int, expire_at, created_by: int) -> bool:
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("INSERT INTO card_keys (key_code, balance, max_uses, expire_at, created_by) VALUES (%s, %s, %s, %s, %s)", (key_code, balance, max_uses, expire_at, created_by))
            conn.commit()
            return True
        except Exception as e:
            logger.error(f"创建卡密失败: {e}")
            conn.rollback()
            return False
        finally:
            cursor.close()
            conn.close()

    def use_card_key(self, key_code: str, user_id: int) -> Optional[int]:
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute("SELECT * FROM card_keys WHERE key_code = %s AND current_uses < max_uses AND (expire_at IS NULL OR expire_at > CURRENT_TIMESTAMP)", (key_code,))
            key = cursor.fetchone()
            if not key:
                return None
            cursor.execute("SELECT * FROM card_key_usage WHERE key_code = %s AND user_id = %s", (key_code, user_id))
            if cursor.fetchone():
                return None
            balance = key['balance']
            cursor.execute("UPDATE card_keys SET current_uses = current_uses + 1 WHERE key_code = %s", (key_code,))
            cursor.execute("INSERT INTO card_key_usage (key_code, user_id) VALUES (%s, %s)", (key_code, user_id))
            cursor.execute("UPDATE users SET balance = balance + %s WHERE user_id = %s", (balance, user_id))
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
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute("SELECT * FROM card_keys ORDER BY created_at DESC")
            return [dict(row) for row in cursor.fetchall()]
        finally:
            cursor.close()
            conn.close()

    def get_all_users(self) -> List[Dict]:
        conn = self.get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute("SELECT * FROM users ORDER BY created_at DESC")
            return [dict(row) for row in cursor.fetchall()]
        finally:
            cursor.close()
            conn.close()

