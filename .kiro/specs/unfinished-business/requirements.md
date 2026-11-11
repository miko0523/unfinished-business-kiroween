# Requirements Document

**Status: Approved (requirements phase) — 2026-11-07; amended 2026-11-07 (shared-floor dollhouse revision, consolidated); amended 2026-11-08 (visual-lead final: motion and light, chores, walking, farewell, archive book, drawer stage, lamps)**

## Introduction

Unfinished Business 是一款静态网页小游戏，也是温柔的任务管理工具。每创建一件未完成的事（Task），就有一只小幽灵（Ghost）搬进侧面剖面的旧宅。玩家澄清完成条件、拆成步骤并逐步完成，Ghost 做家务，颜色与微光随进度变得饱满明亮。玩家明确确认后，Ghost 变金、挥手并飞进纪念册。

MVP 只有四个状态和三种家务；数据只存浏览器本地，无账号、无外部 API、无密钥。

## Glossary

- **App**: 运行于浏览器的静态单页应用，使用者为 **Player**。
- **Task**: 玩家创建的一件事，含 Task_Title、Completion_Criteria、Step 列表与确认状态。
- **Task_Title**: Task 标题，1–80 字符；**Completion_Criteria**: 完成条件，0–200 字符。
- **Step**: Task 下可勾选的小步骤，标题 1–80 字符，每个 Task 最多 50 个。
- **Clarified**: Completion_Criteria 去除首尾空白后非空，且至少有 1 个 Step。
- **Ghost**: 与 Task 一一对应的小幽灵，不命名。内部可有稳定编号，仅用于排序，绝不向玩家显示；玩家可见称呼按 Slot 位置生成，例如“住在二楼左边的小幽灵”。
- **Ghost_State**: Gray（刚创建未澄清）、White（已澄清且 0 步完成）、Green（至少完成一步）、Gold（玩家确认完成后）。
- **Pending_Confirmation**: Task 已 Clarified（Completion_Criteria 非空）、全部 Step 已完成但玩家尚未确认；Completion_Criteria 为空时不论 Step 是否全勾都不是 Pending_Confirmation（Ghost 保持 Gray，不可确认）；Ghost_State 仍为 Green，显示“等你确认 / Ready to confirm”。
- **Confirmed_Task**: 已由玩家明确确认完成的 Task，数据锁定。
- **State_Evaluator**: 仅依据 Task 数据计算 Ghost_State 的纯函数。
- **Progress**: 已完成 Step 数 / Step 总数，同时决定 Ghost 的颜色饱和度与微光亮度。
- **Chore_Action**: 扫地、浇花、擦窗三种家务动画，按 Step 序号（从 0 起）对 3 取余分配。
- **Old_House**: 侧面剖面娃娃屋，最多六层，一楼为门厅与 Ghost_Archive。
- **Floor**: 二至六楼中的一层，横向贯通的共享大房。
- **Slot**: Floor 上左、右两个住客位之一；每层最多两只 Ghost，五层最多十只。Slot 创建时对应一个 Home_Anchor。
- **Home_Anchor**: Slot 对应的左/右静止落点，用于入住、休息与 Reduced_Motion 的静态位置；它不是活动笼子，不限制 Ghost 的活动范围。
- **Roam_Area**: 一个 Floor 整层室内可导航空间，由两只 Ghost 共享；以数据化的可导航区域、障碍物与动作位描述。
- **Obstacle**: 由代码明确声明为不可进入的互动家具或姿势道具区域（含预留区）。Static_Layer 里的床、窗、椅子等背景图案默认不构成 Obstacle，Ghost 可以飘在它们前面。
- **Action_Spot**: Roam_Area 内可做家务、打招呼或一起做家务的命名位置；位置被占用时调度器延后、让位或改选。
- **Resident**: 当前占用 Slot、未确认也未删除的 Ghost。
- **Archive_Book**: 门厅里摊开的大书，是 Ghost_Archive 入口与 Ghost 飞入的目标。
- **Ghost_Archive**: 纪念册，保存所有 Memorial_Entry。
- **Memorial_Entry**: 一条已确认 Task 的纪念记录，含 Stamp 与可选留言。
- **Stamp**: 含完成日期（本地时区 YYYY-MM-DD）、完成 Step 数与固定文字“已圆满 / Complete”的印章。
- **Warm_Lamp**: 门厅或 Archive_Book 旁新增的动态小暖灯或小装饰，每送走一只 Ghost 增加一件，最多 12 件，记录累计完成数；头三件就是门厅素材桌上画着的三盏小灯笼（依次点亮），第 4 至第 12 件是复用的灯笼组件——由项目协作者用图像编辑工具从门厅图右侧的小灯笼提取的派生透明素材（经过轻微重采样与编辑，不是逐像素裁切）。
- **Static_Layer**: 屋顶、门厅与楼层模块的静态布景图片；**Dynamic_Layer**: 叠在其上的 Ghost、光晕、金牌、动画、点击区与任务界面。
- **Save_Data**: 本地保存的全部数据，含 schema_version 字段（仅作标识）。
- **Demo_Mode**: “Try sample”进入的示例体验模式。
- **Reduced_Motion**: 系统 prefers-reduced-motion 为 reduce 的状态。
- **Copy_Resource**: 集中存放全部界面文案的单一资源。

## Requirements

### Requirement 1: 创建 Task 与 Ghost 入住

**User Story:** As a Player, I want to create a Task and have a Ghost move in, so that my unfinished business gets a companion.

#### Acceptance Criteria

1. WHEN Player 提交去除首尾空白后长度为 1–80 字符的 Task_Title, THE App SHALL 创建 Task 与对应 Ghost（Gray），并播放入住动画。
2. IF Task_Title 为空或超过 80 字符, THEN THE App SHALL 拒绝创建并显示说明与字符上限，且保留输入框内容。
3. THE App SHALL 将 Task_Title、Completion_Criteria 与 Step 标题作为纯文本显示，不解释 HTML。
4. WHEN Player 创建 Task 时已有 10 个 Resident, THE App SHALL 不创建 Task、不建立候补队列，并保留输入框草稿。
5. WHEN 满员提示出现, THE App SHALL 显示文案“The house is full. A little ghost is waiting at the door with their luggage. Walk one resident through their journey into the Archive, then welcome them in.”（中文：“旧宅客满了。门口有一只拎着行李的小幽灵在等房间。先陪一位住客走完旅程、进入纪念册，再迎接它。”）及按钮“Visit residents／去看看住客”与“Come back later／稍后再来”。
6. THE 满员提示文案 SHALL 不含催促或愧疚含义。
7. THE App SHALL 允许已确认并进入纪念册的 Task 不占用 Slot 名额。

### Requirement 2: 澄清完成条件与拆分步骤

**User Story:** As a Player, I want to say what “done” means and break it into Steps, so that the Task becomes concrete.

#### Acceptance Criteria

1. THE App SHALL 为每个 Task 提供 Completion_Criteria 编辑入口，上限 200 字符，超限时拒绝保存并显示字符数。首次保存非空内容后，完成条件收成只读文本并带 Edit 按钮；点 Edit 才回到输入框（含 Save 与 Cancel，Cancel 恢复已保存文本且不改数据）；清空并保存则回到首次填写状态。
2. WHEN Player 提交合法 Step 标题, THE App SHALL 在列表末尾追加一个未完成 Step。
3. IF Step 标题为空、超过 80 字符，或 Task 已有 50 个 Step, THEN THE App SHALL 拒绝新增并显示说明。
4. THE App SHALL 允许 Player 编辑、删除 Step，并通过上移／下移按钮（不依赖拖拽）调整顺序；这些操作 SHALL 保持其他 Step 的完成标记不变。
5. WHILE Task 未 Clarified, THE App SHALL 在详情中提示还缺 Completion_Criteria 或 Step。
6. WHEN Task 变为 Clarified 且 Progress 为 0, THE App SHALL 播放 Gray 到 White 的过渡。
7. WHILE Task 为 Confirmed_Task, THE App SHALL 禁止修改其标题、Completion_Criteria 与 Step。

### Requirement 3: 四状态判定

**User Story:** As a Player, I want the Ghost's color to follow clear rules, so that I always understand where a Task stands.

#### Acceptance Criteria

1. THE State_Evaluator SHALL 将 Confirmed_Task 判定为 Gold，其余未 Clarified 的 Task 判定为 Gray。
2. THE State_Evaluator SHALL 将已 Clarified 且完成 Step 数为 0 的未确认 Task 判定为 White，完成 Step 数不小于 1 的未确认 Task 判定为 Green。
3. WHEN Task 已 Clarified、全部 Step 均已完成且 Task 未确认, THE App SHALL 保持 Green，显示“等你确认 / Ready to confirm”，并显示“确认完成”按钮；IF Completion_Criteria 为空而 Step 全部完成, THEN THE App SHALL 保持 Gray、不显示确认入口，并提示补充完成条件，保存后立即进入 Pending_Confirmation（不允许跳过 Completion_Criteria）。
4. THE App SHALL 仅在 Player 明确点击并在对话框中确认“确认完成”后将 Task 判为 Gold；任何 Step 勾选 SHALL 不自动确认。
5. THE State_Evaluator SHALL 仅取决于 Task 数据，不读取当前时间；相同数据 SHALL 得到相同结果。
6. THE App SHALL 不因久未操作而改变任何 Ghost 或 Floor，也不显示断签、连续天数、倒计时或指责类文案。
7. FOR ALL 未确认 Task, 勾选再取消勾选同一 Step SHALL 恢复原 Ghost_State 与 Progress（往返性质）。
8. THE App SHALL 以文字标签与图标（不只颜色或亮度）传达每个状态：Task 详情卡始终显示状态文字与“已完成 X/Y”，状态变化时向 Player 显示新状态名称。

### Requirement 4: 勾选家务与取消勾选

**User Story:** As a Player, I want every finished Step to be rewarded and every mis-tap to be undone gently, so that progress feels light and safe.

#### Acceptance Criteria

1. WHEN Player 勾选一个 Step, THE App SHALL 恰好播放一次对应 Chore_Action（序号对 3 取余：扫地、浇花、擦窗），并更新该 Ghost 的颜色饱和度与微光。
2. THE App SHALL 为只有 1 个或 2 个 Step 的 Task 提供同样种类的反馈（家务动画、颜色与微光、状态变化）。
3. WHEN Player 取消勾选一个 Step, THE App SHALL 将 Progress 如实回退，并播放 Ghost 掏出小橡皮擦两下、掉下几粒灰色碎屑的动画（橡皮在身体外侧，不带任何退步含义），动画结束后颜色与 State_Evaluator 的判定一致。
4. WHEN 取消勾选发生, THE App SHALL 显示“手滑啦，改一下 / Oops, let me fix that”类温柔文案，不表达惩罚、失望或退步。
5. WHEN 取消勾选使 Task 离开 Pending_Confirmation, THE App SHALL 移除“等你确认”、金光或小金牌与“确认完成”按钮。
6. THE App SHALL 使 Chore_Action（不超过 2 秒）与橡皮擦动画（不超过 1.5 秒）不阻塞输入，且可被后续操作打断；打断后最终显示 SHALL 与最新数据一致。
7. WHEN Step 被勾选或取消勾选, THE App SHALL 通过 aria-live 播报状态变化，取消时播报“已取消勾选，进度回到 X/Y”。

### Requirement 5: 确认完成、盖章与告别

**User Story:** As a Player, I want a deliberate confirmation and a warm farewell, so that finishing something feels like a proper ending.

#### Acceptance Criteria

1. WHEN Player 点击“确认完成”, THE App SHALL 显示含“确认完成”与“再想想”的对话框；选择“再想想”或按 Esc SHALL 保持 Task 不变。
2. WHEN Player 确认完成, THE App SHALL 先持久化 Confirmed_Task，再依次播放：Ghost 变金（亮起并撒较满的星星，1 秒）、挥手（开心眼，0.9 秒）、盖章（纪念卡放在幽灵身边的墙面内，不压脸；卡上的字是“一只小幽灵，在 YYYY-MM-DD 圆满”，不含步数；小章在身体外侧落到卡上，卡上留下一枚可见的章印，并冒一颗星，0.9 秒）、小幽灵化成一颗星星沿弧线飞进门厅桌上的 Archive_Book（身后有拖尾，书页亮一下，1.8 秒）；飞行的最后 0.5 秒门厅点亮一盏 Warm_Lamp。
3. IF 确认数据写入失败, THEN THE App SHALL 保持 Task 未确认、不播放变身动画，并提示可重试。
4. WHEN Player 确认完成, THE App SHALL 提供 0–140 字符的可选纪念留言，可留空。
5. WHEN 确认完成, THE App SHALL 新增一条 Memorial_Entry，Stamp 含完成日期、完成 Step 数与固定文字“已圆满 / Complete”，并腾空该 Ghost 的 Slot。
6. THE App SHALL 提供“跳过动画”控件，动画中途刷新后直接显示最终状态（Entry 已存在、Slot 已腾空）。
7. THE App SHALL 使确认完成后的整段庆祝序列（变金、挥手、盖章、飞进纪念册）总时长不超过 5 秒，且 Player 可随时跳过。
8. THE App SHALL 在 MVP 中不提供重新打开 Confirmed_Task 的操作。

### Requirement 6: 旧宅剖面与住客位承载

**User Story:** As a Player, I want my Ghosts to share the floors of a dollhouse, so that the house feels alive.

#### Acceptance Criteria

1. THE Old_House SHALL 以侧面剖面娃娃屋呈现：一楼固定为门厅与 Ghost_Archive（内有 Archive_Book）；二至六楼共五个 Floor，每个为无墙、无分割线、无围栏的共享大房，含左、右两个 Slot。首页只显示已经长出的部分：空房时是门厅、一层住宅与屋顶，随住客增多再逐层长高，最多门厅加五层住宅与屋顶。
2. THE App SHALL 将前两只 Resident 安排在二楼；WHEN 第 3、5、7、9 只 Resident 同时入住, THE Old_House SHALL 顶起屋顶并长出新 Floor（依次三至六楼），已长出的 Floor 不再塌回，首页显示的层数 SHALL 始终等于已长出的层数（空房与前两只住客时只有门厅、二楼与屋顶）。
3. THE App SHALL 将新 Ghost 分配到最低 Floor 的第一个空 Slot（左先右后）；WHEN Ghost 完成离开或被删除, THE App SHALL 只腾出其自己的 Slot，室友留在原位。
4. WHEN Player 点击某只 Ghost 本人, THE App SHALL 选中并打开其对应 Task 详情；点击 Floor 的空白处、家具、墙面或空 Slot SHALL 不打开任何 Task，空 Slot SHALL 不可交互。
5. THE App SHALL 使每只 Ghost 在所在 Floor 的整层室内共享 Roam_Area 中四处飘动并做家务（包括窗边、床边、房间中央与半空），也可在动作位打招呼或一起做家务；允许经过对方原本的半边，不要求左右位置保持不变。WHEN Ghost 被选中, THE Ghost SHALL 停在当下合法位置，不再飘动；WHEN Ghost 休息或处于 Reduced_Motion, THE Ghost SHALL 回到自己的 Home_Anchor。任何时刻 SHALL 满足：Ghost 连同当前动作道具不越出室内墙体、地板、天花板边界；两只 Ghost 不重叠；不与代码明确声明的 Obstacle 或 Action_Spot 预留区重叠；移动全程（不只终点）都满足以上条件。Static_Layer 里的床、窗、椅子等背景图案默认不阻挡 Ghost。动作位被占用或空间不足时延后、让位或改选其他动作位。参数以 design.md 为准。
6. THE App SHALL 使每只 Ghost 成为可聚焦按钮，按 Floor 从上到下、同层从左到右聚焦，并提供顺序一致的语义化列表分组，不重复渲染两套控件。
7. WHEN 一只 Ghost 确认完成并告别且 Warm_Lamp 少于 12 盏, THE Old_House SHALL 永久增加 1 盏 Warm_Lamp；最多 12 盏，不因删除减少，不依赖时间，删除未完成 Task 不增加。头三盏为门厅原画的灯笼，依次叠暖光与火苗，原画不动；第 4–12 盏复用从门厅图经图像编辑提取的透明组件（非逐像素裁切，运行 PNG 为 64×96，来源见 ASSETS.md），挂在门边、墙角、桌边空墙，高低错落，不排成直线，不加新家具。新增灯 SHALL 避开书、门、花架、原灯及住客，互不重叠。暖金光慢呼吸周期不短于 3 秒、透明度波动不超过 15%，不闪，可轻微摇曳火苗，Reduced_Motion 下静止；飞行最后 0.5 秒点亮并冒一两颗小星，初始化与刷新不补播。
8. WHILE Task 处于 Pending_Confirmation, THE App SHALL 将其 Ghost 显示为最亮的绿色，并带细金光或小金牌与文字“等你确认 / Ready to confirm”，无闪烁；金光 MAY 做缓慢柔和的呼吸起伏（周期不短于 2 秒），Reduced_Motion 下保持静止；全景中金光或小金牌 SHALL 同样可见，文字标签可缩为小徽章，但 SHALL 始终包含在该 Ghost 的可访问名称中。Ghost 的进度 SHALL 仅由其自身的灰、白、绿、等待确认金光与确认后短暂变金表达，并始终配有文字与步数。
9. THE Old_House 的 Static_Layer SHALL 不随任何 Task 的进度变亮或变色。
10. THE App SHALL 将 Static_Layer（PNG）与 Dynamic_Layer 分层且不修改 Static_Layer 图片内容；长楼时只插入一个新 Floor 模块并移动屋顶；各 Floor 可有轻微确定性左右错位，拼接处 SHALL 不断裂；SHALL 优先使用 2× 素材并按显示尺寸选版本。

### Requirement 7: 删除、纪念册与隐私

**User Story:** As a Player, I want to remove Tasks calmly and keep private titles hidden in the keepsake book, so that I can show the book safely.

#### Acceptance Criteria

1. WHEN Player 删除未完成 Task 并确认, THE App SHALL 永久移除 Task 与 Ghost，腾空其 Slot，并播放 Ghost 拎行李安静搬走的动画，不写入 Ghost_Archive。
2. THE 删除相关文案 SHALL 使用“搬走／告别”等中性词，不使用“放弃／失败”等词。
3. THE Ghost_Archive SHALL 按完成时间由新到旧列出全部 Memorial_Entry，显示金色 Ghost、Stamp 与留言（若有）。
4. THE Ghost_Archive SHALL 默认隐藏 Task_Title；Player 逐条主动选择后才显示，并可再次隐藏，选择 SHALL 被持久化。
5. WHILE 某条 Entry 的 Task_Title 为隐藏, THE App SHALL 不在可见文本、alt／title、aria 文本、页面标题与 URL 中输出该 Task_Title。
6. IF Ghost_Archive 为空, THEN THE App SHALL 显示不含催促或愧疚含义的引导画面。
7. THE Ghost_Archive 打开时 SHALL 呈现为摊开的泛黄旧书：中间有连续书脊阴影，纸纹、略旧四角和叠纸边，标题为页顶小字，不使用棕色标题栏或条目卡片框；翻开时扬起几粒灰尘（Reduced_Motion 下不扬）。Stamp 按左右页一行两列排开，每格是一枚章加原圆满文案；新送走的那只最后落章，之前的已在页上。标题显隐为章下的小字链接外观，保留键盘操作、读屏和触控区。Archive_Book 就是门厅桌上的大书。

### Requirement 8: Ghost 角色视觉

**User Story:** As a Player, I want one consistent, lovable Ghost whose look shows its progress, so that it feels like the same friend through every stage.

#### Acceptance Criteria

1. THE App SHALL 仅用原创 SVG 与 CSS 绘制 Ghost 本体，不使用位图，不使用或描摹参考图；仓库 SHALL 不含参考图，README SHALL 说明 Ghost 为原创。Static_Layer 的 PNG 不受本条限制。
2. THE Ghost SHALL 在四个状态下使用相同的主体轮廓路径数据，仅以颜色、透明度、光晕与整体缩放区分；整体视觉尺寸约为早期版本的 82%–86%，点击热区仍不小于 44×44px。
3. THE Ghost SHALL 无嘴无鼻，情绪仅由眼睛表达；默认眼睛为较大的纯深色竖椭圆，腮红保留。
4. THE Ghost SHALL 有两只可独立变换、贴着身体两侧的小短手、无腿，主体是一条圆润连续的钟形轮廓，底部有四瓣大小不一、不对称的圆润裙边（全部落在图形范围内，不做尖长的蕾丝）。
5. THE Ghost SHALL 在头顶有雾藤呆毛作为固定识别锚点（顶端卷成清楚的小环），四个状态下均存在。
6. THE App SHALL 通过身体倾斜、轻微 squash／stretch、前景道具与裙边余晃表现动作，不改变轮廓路径数据。
7. THE Ghost SHALL 在 320px 宽度下保持轮廓、眼睛、小手与呆毛可辨认，并具有包含状态名称的可访问名称；纯装饰图形 SHALL 对辅助技术隐藏。
8. THE Ghost SHALL 以外观表达进度：Gray 偏灰、微光很弱；White 柔和暖白并带明显的微光；Green 柔和的绿色，颜色饱和度与微光随 Progress 单调不减；Pending_Confirmation 为最亮的绿色并带细金光或小金牌；Gold 为金色并带温暖的光晕。状态切换时颜色与光晕 SHALL 平滑过渡，易于察觉但不闪烁。
9. THE App SHALL 仅在 Ghost 被鼠标 hover 或键盘 focus-visible 时于其脚下短暂显示状态图标与步数小标签（默认与选中、抽屉打开时均隐藏，触摸设备不常驻；Reduced_Motion 下无过渡）；Ghost 的可访问名称 SHALL 始终含状态名与“X of Y done”；任务卡的状态文字与步数始终显示。
10. THE Ghost SHALL 平时安静：明显而缓慢地上下漂浮（周期不短于 4.5 秒），光晕缓慢呼吸，不撒粒子；热闹只放在事件上：入住落地、变白、变绿、做完一件家务时撒少量星星（星星淡入、飘散、淡出，单颗不短于 0.9 秒），变金与告别撒得最满并带拖尾。全部动画不闪烁（亮度不快速跳变）。
11. THE 家务 SHALL 每个约 2 秒（不超过 2 秒）：扫地——小扫把左右扫三下、地上扬几粒灰、扫完灰变成两三颗小星；浇花——歪着小水壶、三滴水落进花盆、盆里冒一个小芽；擦窗——抹布在窗上画两个圈、玻璃闪过一道亮光。做的时候专注眼，做完开心眼；道具与特效都画在身体外侧，靠道具那一侧的小手整只抬起、移到道具上握住，并跟着道具的节奏小幅摆动（不是只绕肩转动；道具放大到一眼能看清，且离身体有明显距离）；身体向另一侧让出位置，道具及其摆幅 SHALL 完全落在带道具的碰撞盒内，不越出墙体、不与室友重叠。擦窗时 Ghost SHALL 略飘高到窗旁再擦。取消勾选的橡皮擦两下 SHALL 同样在身体外侧，并带几粒灰色碎屑。
12. THE Ghost SHALL 在水平漫游时脸朝前：眼睛与腮红整体朝前进方向挪身体宽度的 8%–10%，身体微微前倾、裙边向后飘，停下时脸回正；垂直移动不挪脸。
13. THE App SHALL 在 Reduced_Motion 下不播放漂浮、漫游、粒子、拖尾与手脚动画，只保留颜色变化与静态表情；WHILE 页面隐藏，THE App SHALL 暂停全部装饰动态；WHEN 有新事件, THE App SHALL 先取消该 Ghost 正在进行的旧动作与尚未播出的迟到特效，最终显示以最新数据为准。

### Requirement 9: 本地持久化与数据安全

**User Story:** As a Player, I want my data saved on my device with a safe way out when something breaks, so that I never silently lose my Ghosts.

#### Acceptance Criteria

1. WHEN 数据发生变更, THE App SHALL 在 300 毫秒防抖后将完整 Save_Data 保存到浏览器本地存储，并在启动时恢复；WHEN 页面变为隐藏, THE App SHALL 立即保存尚未写入的变更；确认完成不适用防抖，按 Requirement 5 的同步写入并校验成功后才播放动画。
2. THE Save_Data SHALL 含 schema_version 字段（仅作标识）、全部 Task、Memorial_Entry、完成计数与设置。
3. WHEN Player 点击导出, THE App SHALL 先以绘本口吻提示文件会带走全部原始文字，再下载 UTF-8 JSON 备份。
4. IF 本地存储不可用或写满, THEN THE App SHALL 以绘本口吻说明这次没能把东西收好，并提供导出入口。
5. IF 本地数据解析或校验失败，或 schema_version 不受支持, THEN THE App SHALL 不覆盖、不清空、不自动初始化原数据，并进入恢复界面；页面打开时 THE App SHALL 不自动处理、不自动备份、不自动重置坏存档，一切处理等待 Player 主动选择。
6. WHILE 恢复界面未被处理, THE App SHALL 不向原存储键写入；唯一例外是第 7 条选项③在备份成功后写入新建的空 Save_Data，以及该写入失败时对原始坏数据的尽力还原（见第 9 条）。
7. THE 恢复界面 SHALL 以绘本口吻说明发生了什么与可以做什么，并提供三个选项：①下载损坏数据副本，内容为读到的原始字符串；②用空白数据在内存中继续，不向任何存储键写入；③“备份坏存档并重新开始 / Back up the old save and start fresh”。
8. WHEN Player 选择选项③并在确认对话框中确认, THE App SHALL 先将原始损坏字符串原样写入独立备份键并读回，读回内容与原字符串逐字符一致后，才新建空 Save_Data 并写入主存储；写入后 SHALL 立即读回主存储，读回内容与刚写入的内容逐字符一致，才算成功并离开恢复界面。
9. IF 备份写入失败或读回内容与原字符串不一致, THEN THE App SHALL 不清空、不覆盖原数据，保持在恢复界面，以温柔文案提示，并继续允许选项①与②。IF 备份已成功但新空存档写入失败、读回失败或读回内容与刚写入的内容不一致, THEN THE App SHALL 保留已成功的坏存档备份，停留在恢复界面，以温柔文案提示，不得提示成功，并继续允许选项①与②；若主存储已被触及，THE App SHALL 尽力将其还原为原始坏数据，还原失败也 SHALL 不删除该备份。
10. THE App SHALL 在 MVP 中不提供数据导入、合并与 schema 迁移。
11. FOR ALL 合法 Save_Data, 序列化后再解析 SHALL 得到等价数据（往返性质）；FOR ALL 非法输入, Parser SHALL 返回错误而不抛出未捕获异常。

### Requirement 10: Demo 体验

**User Story:** As a judge, I want a quick sample, so that I can try the whole loop in about 30 seconds.

#### Acceptance Criteria

1. THE App SHALL 提供“Try sample”按钮，载入一只位于二楼某个 Slot、已拆成 3 个 Step（覆盖三种家务）的示例 Ghost。
2. THE Demo_Mode SHALL 支持勾选、变色、橡皮擦撤销、确认完成、盖章与飞进纪念册。
3. THE Demo_Mode SHALL 使用独立内存或独立存储键，不读写真实存档键。
4. THE App SHALL 在 Demo_Mode 中显示“Exit demo”入口；退出后 SHALL 不改变玩家真实数据。
5. THE Demo_Mode SHALL 遵守 Reduced_Motion 与全部无障碍要求。

### Requirement 11: 语言、无障碍、减少动态与响应式

**User Story:** As a Player on any device or with any need, I want the game readable and usable, so that it is comfortable for me.

#### Acceptance Criteria

1. THE App SHALL 在首次访问时默认英文，不自动跟随浏览器语言；提供 English／简体中文切换，并将 Player 手动选择的语言持久化到本地设置，但在恢复界面与内存模式下语言切换仅在本次会话有效、不写入存储；全部文案 SHALL 集中于 Copy_Resource；英文界面 SHALL 完整。
2. THE 简体中文切换 SHALL 为可裁剪项，英文界面不可裁剪。
3. THE App SHALL 支持键盘完成全部流程；对话框 SHALL 将焦点移入、循环并在关闭后返回触发控件；焦点样式清晰可见。
4. THE App SHALL 使正文对比度不低于 4.5:1、关键图形与组件边界不低于 3:1。
5. WHILE Reduced_Motion 生效, THE App SHALL 不播放位移、旋转、缩放或循环动画，详情抽屉滑出、镜头与滚动切换改为即时切换，氛围背景保持静态（萤火不动、不闪），其余改用静态表情、文字说明与不超过 200ms 的颜色切换（不播放漂浮、漫游、粒子、拖尾与手脚动画）。
6. THE App SHALL 仅跟随系统 prefers-reduced-motion，不提供应用内开关。
7. THE App SHALL 在 320px 宽度下无水平滚动，触控目标不小于 44×44px，正文不小于 16px，允许缩放与纵向滚动查看高楼，主要呈现为房屋剖面而非 Task 列表。
8. THE App SHALL 使用语义化地标与标题，html 的 lang SHALL 与当前语言一致。
9. THE 界面文案 SHALL 不含断签、逾期、羞辱、催促或愧疚类词语。
10. THE 全部玩家可见文字 SHALL 自然、温暖、俏皮，像绘本里的话；游戏界面 SHALL 不出现哈希、版本号、存储键名、内部编号、技术或素材来源说明、法律腔免责声明或实现细节（它们只进入代码、测试与仓库文档）。
11. THE 错误、恢复与导出相关的玩家可见文案 SHALL 用绘本口吻说明发生了什么与可以做什么。
12. THE App SHALL 在所有视口宽度下把 Task 详情卡呈现为从屏幕底部滑出的半透明磨砂抽屉：暖米色、圆角、背景模糊、边缘与阴影轻柔，不像办公软件；宽屏时抽屉居中且宽度不超过约 760px，窄屏时贴近两侧；高度不超过视口的约 58%，内容过多时只在抽屉内部滚动。WHERE 视口宽度不小于 900px, THE App SHALL 将旧宅居中，左右铺深蓝夜空、月亮、远树、萤火等对辅助技术隐藏的装饰背景；旧宅 SHALL 不因详情卡打开而移动或缩放。夜景为：深蓝夜空渐变、月亮、静态星点（不闪烁）、两侧远处树影剪影，加几只慢慢飘的萤火；全部用代码绘制。
13. WHEN Player 点击 Ghost 打开详情抽屉（或在抽屉打开时改选另一只）, THE App SHALL 使这只 Ghost 的本体从屋里飘出来，落在抽屉上沿正中的小舞台上，跟着抽屉待着；屋里不留复制品或影子；舞台上的它照常有表情（勾一步开心一下，取消勾选疑惑后安心）。WHEN 抽屉关闭, THE Ghost SHALL 沿原路飘回屋里原位。Reduced_Motion 下不飘，直接出现在舞台上、直接回去。因为舞台总在抽屉上沿，页面 SHALL 不再需要为露出 Ghost 而滚动（原“最小幅度滚动露出”降为舞台不可用时的兜底）。WHERE 视口宽度小于 900px, THE App SHALL 默认聚焦当前活动的 Floor（最近被创建、点击或勾选的 Ghost 所在 Floor；尚无时取有住客的最低 Floor；无住客时取二楼），并提供“View full house／看全景”入口。
14. WHILE 全景缩小, WHEN Player 点击某只 Ghost, THE App SHALL 先聚焦其所在 Floor，再次点击才打开 Task 详情。
15. THE App SHALL 使旧宅保持最大宽度并居中，超宽屏不拉伸，外围继续铺夜景背景。

### Requirement 12: 静态托管、隐私与仓库交付

**User Story:** As a maintainer, I want a self-contained static project, so that anyone can run, verify and reuse it.

#### Acceptance Criteria

1. THE 构建产物 SHALL 仅含 HTML、CSS、JavaScript 与静态资源，使用相对路径，无需服务端路由重写。
2. THE App SHALL 无账号、外部 API、第三方统计或 CDN、密钥与权限请求。
3. THE 构建产物 SHALL 能通过本地预览、普通静态托管与 GitHub Pages 子路径部署正常运行。
4. WHEN 页面加载后设备离线, THE App SHALL 保持 MVP 功能可用；MVP 不使用 Service Worker。
5. THE 仓库 SHALL 保留 .kiro 目录（不被 .gitignore 排除，含 requirements.md、design.md、tasks.md）。
6. THE 仓库 SHALL 含 MIT LICENSE 与 README；README SHALL 含简介、截图或动图、安装／开发／测试／构建／部署步骤、本地存储与导出说明、原创 Ghost 说明、依赖与许可证。
7. THE 仓库 SHALL 提供一条构建命令与一条测试命令，测试 SHALL 覆盖状态判定、Progress 计算、序列化／解析与住客位分配。
8. THE 仓库 SHALL 在公开前确认不含私密资料、密钥与本机绝对路径。
9. THE 仓库 SHALL 含 ASSETS.md，说明原创设计（Ghost 与氛围背景）、项目发起人用 ChatGPT 根据原创提示生成、由 Kiro 接入互动的静态旧宅布景素材，以及将来可能使用的第三方素材与许可证。

## Post-MVP（非 MVP 范围）

以下项目不计入 MVP 验收；MVP 不留入口、占位或“敬请期待”。

- 数据导入；schema 迁移与版本化自动备份；多标签页同步
- 1000 Task 性能与虚拟列表；搜索、筛选、分页
- PWA／Service Worker；重新打开已确认 Task
- Ghost 改名、随机名字池、饰品、Purple／Red、隐藏区域、额外家务、复杂收集、声音、通知、社交分享
- 更多语言；应用内减少动态开关；候补队列
- 手动排序；住客位自定义位置；超过六层／十个 Slot 的扩展与更多楼层模块
- 多个氛围主题；可选第三方素材

## Requirement 13: 图鉴、揭雾与提灯住客（阶段 13 后扩展）

1. 前十二次明确确认完成按顺序解锁信封、钥匙、茶杯、纸鹤、小船、蜡烛、月亮、风筝、怀表、小雨伞、种子、门。章共享金色双圆框，物件各异；未获得显示灰虚线圈、灰剪影和问号。独立纪念不封顶，超过十二次后物件按同序循环，图鉴封顶十二。
2. 纪念册保留倒序、两列独立纪念和逐条标题隐私；其后是十二章图鉴，最后是四列三行的提灯住客揭雾页。固定顺序先四角再边缘，脸部两格最后揭开，第十二格露出眼睛。必须核对实际底图几何。
3. 提灯身份使用 #F4813B 身体、白描边白眼、淡粉腮红、暖黄头顶星与右手暖黄灯笼，沿用完整连续轮廓。身份与任务进度独立；状态文字、步数、确认入口和确认规则不变。
4. 累计十二次完成后下一次成功创建保证为提灯；此后成功创建采样一次，概率 5%。身份及保证兑现状态写入同一存档；非法输入、满员和存储失败不能消耗保证，不发布入住事件。刷新不重抽，旧任务不改身份。缺扩展字段的旧存档按完成数派生图鉴与待兑现保证。
5. 提灯入住只让已经获得的门厅灯短暂共同增亮，不改变完成数、纪念、灯数。减少动态时提供短暂静态回应，不播放擦雾或光脉冲。
6. 全部新增文案中英文完整；示例、恢复、内存模式继续隔离；隐藏标题不得进入文本、URL、ARIA 或图形属性。
7. 构建、单测、完整浏览器回归与桌面/320 宽原始截图完成后交独立复核，浏览器视口模拟不等于实体设备或最终视觉验收。本扩展不启动阶段 14–17。
