# SheerID 军人验证配置文件

# SheerID API 配置
SHEERID_BASE_URL = 'https://services.sheerid.com'
MY_SHEERID_URL = 'https://my.sheerid.com'

# 军人状态选项
MILITARY_STATUS = {
    'VETERAN': 'VETERAN',  # 退伍军人
    'ACTIVE': 'ACTIVE',    # 现役军人
    'RESERVE': 'RESERVE'   # 预备役军人
}

# 默认使用退伍军人状态
DEFAULT_STATUS = 'VETERAN'

# 军队组织配置（美国军队）
MILITARY_ORGANIZATIONS = {
    '4070': {
        'id': 4070,
        'idExtended': '4070',
        'name': 'Army',
        'country': 'US',
        'type': 'MILITARY',
        'latitude': 39.7837304,
        'longitude': -100.445882
    },
    '4073': {
        'id': 4073,
        'idExtended': '4073',
        'name': 'Air Force',
        'country': 'US',
        'type': 'MILITARY',
        'latitude': 39.7837304,
        'longitude': -100.445882
    },
    '4072': {
        'id': 4072,
        'idExtended': '4072',
        'name': 'Navy',
        'country': 'US',
        'type': 'MILITARY',
        'latitude': 39.7837304,
        'longitude': -100.445882
    },
    '4071': {
        'id': 4071,
        'idExtended': '4071',
        'name': 'Marine Corps',
        'country': 'US',
        'type': 'MILITARY',
        'latitude': 39.7837304,
        'longitude': -100.445882
    },
    '4074': {
        'id': 4074,
        'idExtended': '4074',
        'name': 'Coast Guard',
        'country': 'US',
        'type': 'MILITARY',
        'latitude': 39.7837304,
        'longitude': -100.445882
    },
    '4544268': {
        'id': 4544268,
        'idExtended': '4544268',
        'name': 'Space Force',
        'country': 'US',
        'type': 'MILITARY',
        'latitude': 39.7837304,
        'longitude': -100.445882
    }
}

# 默认军队组织（陆军）
DEFAULT_ORGANIZATION_ID = '4070'
