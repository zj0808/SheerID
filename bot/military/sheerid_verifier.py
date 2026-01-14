"""SheerID 军人验证主程序"""
import re
import random
import logging
import httpx
from typing import Dict, Optional, Tuple

try:
    from . import config
    from .name_generator import (
        NameGenerator,
        generate_email,
        generate_birth_date,
        generate_discharge_date
    )
except ImportError:
    import config
    from name_generator import (
        NameGenerator,
        generate_email,
        generate_birth_date,
        generate_discharge_date
    )

# 导入配置常量
SHEERID_BASE_URL = config.SHEERID_BASE_URL
MY_SHEERID_URL = config.MY_SHEERID_URL
MILITARY_STATUS = config.MILITARY_STATUS
DEFAULT_STATUS = config.DEFAULT_STATUS
MILITARY_ORGANIZATIONS = config.MILITARY_ORGANIZATIONS
DEFAULT_ORGANIZATION_ID = config.DEFAULT_ORGANIZATION_ID

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)


class SheerIDVerifier:
    """SheerID 军人身份验证器"""

    def __init__(self, verification_id: str):
        """
        初始化验证器

        Args:
            verification_id: SheerID 验证 ID
        """
        self.verification_id = verification_id
        self.device_fingerprint = self._generate_device_fingerprint()
        self.http_client = httpx.Client(timeout=30.0)

    def __del__(self):
        """清理 HTTP 客户端"""
        if hasattr(self, 'http_client'):
            self.http_client.close()

    @staticmethod
    def _generate_device_fingerprint() -> str:
        """生成设备指纹"""
        chars = '0123456789abcdef'
        return ''.join(random.choice(chars) for _ in range(32))

    @staticmethod
    def normalize_url(url: str) -> str:
        """规范化 URL"""
        return url

    @staticmethod
    def parse_verification_id(url: str) -> Optional[str]:
        """从 URL 中解析验证 ID"""
        match = re.search(r'verificationId=([a-f0-9]+)', url, re.IGNORECASE)
        if match:
            return match.group(1)
        return None

    def _sheerid_request(
        self, method: str, url: str, body: Optional[Dict] = None
    ) -> Tuple[Dict, int]:
        """
        发送 SheerID API 请求
        """
        headers = {
            'Content-Type': 'application/json',
        }

        try:
            response = self.http_client.request(
                method=method,
                url=url,
                json=body,
                headers=headers
            )

            try:
                data = response.json()
            except Exception:
                data = response.text

            return data, response.status_code
        except Exception as e:
            logger.error(f"SheerID 请求失败: {e}")
            raise

    def verify(
        self,
        first_name: str = None,
        last_name: str = None,
        email: str = None,
        birth_date: str = None,
        organization_id: str = None,
        discharge_date: str = None,
        military_status: str = None
    ) -> Dict:
        """
        执行完整的军人验证流程（两步认证）

        Args:
            first_name: 名字
            last_name: 姓氏
            email: 邮箱
            birth_date: 出生日期
            organization_id: 军队组织ID
            discharge_date: 退役日期
            military_status: 军人状态（VETERAN/ACTIVE/RESERVE）

        Returns:
            Dict: 验证结果
        """
        try:
            current_step = 'initial'

            # 生成军人信息
            if not first_name or not last_name:
                name = NameGenerator.generate()
                first_name = name['first_name']
                last_name = name['last_name']

            organization_id = organization_id or DEFAULT_ORGANIZATION_ID
            organization = MILITARY_ORGANIZATIONS[organization_id]
            military_status = military_status or DEFAULT_STATUS

            if not email:
                # 使用固定邮箱以便接收验证邮件
                email = 'xiaoqi@zjgyy.me'

            if not birth_date:
                birth_date = generate_birth_date()

            if not discharge_date:
                discharge_date = generate_discharge_date()

            logger.info(f"军人信息: {first_name} {last_name}")
            logger.info(f"邮箱: {email}")
            logger.info(f"军队: {organization['name']}")
            logger.info(f"生日: {birth_date}")
            logger.info(f"退役日期: {discharge_date}")
            logger.info(f"军人状态: {military_status}")
            logger.info(f"验证 ID: {self.verification_id}")

            # ========== 第一步：收集军人状态 ==========
            logger.info("步骤 1/2: 提交军人状态...")
            step1_body = {
                'status': military_status
            }

            step1_data, step1_status = self._sheerid_request(
                'POST',
                f"{SHEERID_BASE_URL}/rest/v2/verification/{self.verification_id}/step/collectMilitaryStatus",
                step1_body
            )

            if step1_status != 200:
                raise Exception(f"步骤 1 失败 (状态码 {step1_status}): {step1_data}")

            if step1_data.get('currentStep') == 'error':
                error_msg = ', '.join(step1_data.get('errorIds', ['Unknown error']))
                raise Exception(f"步骤 1 错误: {error_msg}")

            logger.info(f"✓ 步骤 1 完成: {step1_data.get('currentStep')}")
            current_step = step1_data.get('currentStep', current_step)
            submission_url = step1_data.get('submissionUrl')

            if not submission_url:
                raise Exception("未获取到 submissionUrl")

            # ========== 第二步：收集非现役军人个人信息 ==========
            logger.info("步骤 2/2: 提交军人个人信息...")
            step2_body = {
                'firstName': first_name,
                'lastName': last_name,
                'birthDate': birth_date,
                'email': email,
                'phoneNumber': '',
                'organization': {
                    'id': organization['id'],
                    'name': organization['name']
                },
                'dischargeDate': discharge_date,
                'locale': 'en-US',
                'country': 'US',
                'metadata': {
                    'marketConsentValue': False,
                    'refererUrl': '',
                    'verificationId': self.verification_id,
                    'flags': '{"doc-upload-considerations":"default","doc-upload-may24":"default","doc-upload-redesign-use-legacy-message-keys":false,"docUpload-assertion-checklist":"default","include-cvec-field-france-student":"not-labeled-optional","org-search-overlay":"default","org-selected-display":"default"}',
                    'submissionOptIn': 'By submitting the personal information above, I acknowledge that my personal information is being collected under the <a target="_blank" rel="noopener noreferrer" class="sid-privacy-policy sid-link" href="https://openai.com/policies/privacy-policy/">privacy policy</a> of the business from which I am seeking a discount, and I understand that my personal information will be shared with SheerID as a processor/third-party service provider in order for SheerID to confirm my eligibility for a special offer. Contact OpenAI Support for further assistance at support@openai.com'
                }
            }

            # 使用从第一步返回的 submission_url
            step2_data, step2_status = self._sheerid_request(
                'POST',
                submission_url,
                step2_body
            )

            if step2_status != 200:
                raise Exception(f"步骤 2 失败 (状态码 {step2_status}): {step2_data}")

            if step2_data.get('currentStep') == 'error':
                error_msg = ', '.join(step2_data.get('errorIds', ['Unknown error']))
                raise Exception(f"步骤 2 错误: {error_msg}")

            logger.info(f"✓ 步骤 2 完成: {step2_data.get('currentStep')}")
            current_step = step2_data.get('currentStep', current_step)
            final_status = step2_data

            # 构建返回结果
            result = {
                'success': True,
                'verification_id': self.verification_id,
                'current_step': current_step,
                'redirect_url': final_status.get('redirectUrl'),
                'pending': current_step in ['pending', 'docUpload', 'collectInactiveMilitaryPersonalInfo'],
                'data': final_status
            }

            if current_step == 'success':
                logger.info("✅ 验证成功！")
                result['pending'] = False
            elif current_step in ['pending', 'docUpload']:
                logger.info("⏳ 文档已提交，等待审核...")
                result['pending'] = True
            else:
                logger.info(f"当前状态: {current_step}")

            return result

        except Exception as e:
            logger.error(f"❌ 验证失败: {e}")
            return {
                'success': False,
                'message': str(e),
                'verification_id': self.verification_id
            }
