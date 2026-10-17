// Player-facing release notes for the start screen's 更新日志 tab, newest first. Add a new entry at the top for every
// release players can notice; the first entry is shown as the current version.

export type Release = { version: string; date: string; title: string; notes: readonly string[] };

export const RELEASES: readonly Release[] = [
    {
        version: 'v0.10.0',
        date: '2026.10.17',
        title: '房间按最新图纸命名',
        notes: [
            '房间名称与划分改按 2026.08.06 建筑图纸，校园比例和墙体保持不变。',
            '新增小剧场、创新区、Moon Coffee、茶馆、大自习室及各处卫生间。',
            '阅览室、大自习室、心理办公室、小初办公室等房间名称按新图纸更新。',
            '多块区域合并的房间只保留一块门牌；没有图纸编号的空间不再显示内部代码。'
        ]
    },
    {
        version: 'v0.9.0',
        date: '2026.10.17',
        title: '更公平的命中判定',
        notes: [
            '命中按投掷者屏幕上看到的位置判定（延迟补偿上限 200 ms），头部或身体按当时的高度判断。',
            '隔着墙、玻璃或边界的命中一律无效；飞盘反弹后的命中照常有效。',
            '回合结束后的投掷和命中不再计入。',
            '纪老师监视圈内禁止处决；处决改为飞盘劈颈动作，双方显示各自颜色。',
            '本局出局的玩家使用观战频道聊天，存活玩家看不到。',
            '角色改为整体纯色，关节和头部与身体同色。'
        ]
    },
    {
        version: 'v0.8.1',
        date: '2026.10.17',
        title: '登录修复',
        notes: ['正式环境的登录和排行榜请求改走同域接口，避免偶发的登录失败。', '网络短暂异常时不再清除已保存的登录。']
    },
    {
        version: 'v0.8.0',
        date: '2026.10.17',
        title: '音乐与音效',
        notes: [
            '新增开场音乐（播放到停电）、渐入的停电主题和决战主题音乐。',
            '断电改用蜂鸣提示音；金飞盘击杀保留专属音效。',
            '关键战斗音效优先播放，飞盘掠过声定位到最近点。',
            '飞盘爆头判定区收紧到头部。'
        ]
    },
    {
        version: 'v0.7.0',
        date: '2026.10.17',
        title: '战斗手感升级',
        notes: [
            '命中先显示预测标记，服务器确认后才播放正式的命中、淘汰反馈。',
            '新增镜头冲击、受击反应和更柔和的受伤画面提示，可在设置中调低。',
            '回合结果区分持金飞盘获胜、最后幸存和平局。',
            '停电时天空与灯光渐变；最后一分钟转场到莲花球场时加入遮罩过渡。'
        ]
    },
    {
        version: 'v0.6.0',
        date: '2026.10.17',
        title: '全新角色模型',
        notes: [
            '所有角色改用带骨骼动画的人形模型（2.1 m），手部握持飞盘。',
            '新增投掷动作，其他玩家可同步看到。',
            '可上传图片作为角色头像。',
            '卫生间加入镜子，可以看到自己。'
        ]
    },
    {
        version: 'v0.5.0',
        date: '2026.10.17',
        title: '配电室、处决与监控室',
        notes: [
            '西侧配电室可拉闸断电，每局全服一次；保安约 35 秒后到场恢复。',
            '新增背后处决：靠近对手背后按 V，双方同步动作后对手出局。',
            '监控室电脑：瞄准点击可查看其他玩家位置 30 秒。',
            '地图标出配电室、监控室和体育办公室。',
            '胜率指数改为从 100% 起步、每次输局乘以 0.95。',
            '首页新增更新日志；罚站期间不再弹出脱困提示。'
        ]
    },
    {
        version: 'v0.4.0',
        date: '2026.10.16',
        title: '爆头与停电',
        notes: ['飞盘爆头一击淘汰。', '回合最后几分钟熄灯，夜间保安巡逻，被手电照到即出局。', '新增胜率排行榜。']
    },
    {
        version: 'v0.3.0',
        date: '2026.10.16',
        title: '多人飞盘对战',
        notes: [
            '所有玩家进入同一个校园，按住左键蓄力投掷飞盘。',
            '账号登录、终身淘汰数与淘汰王称号。',
            '金飞盘回合：回合结束时持有金飞盘的玩家获胜。',
            '全服聊天、命中特效与音效。'
        ]
    },
    {
        version: 'v0.2.0',
        date: '2026.10.16',
        title: '校园呈现',
        notes: [
            '3.6 m 墙体与天花板、露天莲花球场、门、家具、灯光与天空。',
            '打通原本封闭的房间，新增圆形小地图和全图。',
            '重新设计开始界面与游戏内界面。'
        ]
    },
    {
        version: 'v0.1.0',
        date: '2026.10.15',
        title: '校园漫游',
        notes: [
            '载入 FF-01 校园模型，第一人称行走、冲刺、跳跃。',
            '墙体碰撞、跌落自动回到入口，进入房间显示房号与名称。'
        ]
    }
];

const escape = (text: string) =>
    text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The release list markup: one card per version, the newest marked as current. */
export const changelogHtml = (releases: readonly Release[] = RELEASES) =>
    releases
        .map(
            (release, index) => `<li class="release-entry"${index === 0 ? ' data-current="true"' : ''}>
              <header><b>${escape(release.version)} · ${escape(release.date)}</b>${index === 0 ? '<span>当前版本</span>' : ''}</header>
              <h3>${escape(release.title)}</h3>
              <ul>${release.notes.map((note) => `<li>${escape(note)}</li>`).join('')}</ul>
            </li>`
        )
        .join('\n');
