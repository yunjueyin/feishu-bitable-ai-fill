# AI 评论拟人化工具（Flutter 三端通用 · MVP）

让 AI 生成的小红书 / 抖音评论更有"人味"的端到端工具。**一套 Dart 代码**，可同时出
**APK（Android）**、**便携桌面应用（Windows / Linux）**、**网页应用（Web）**。

> 定位：提升自有内容的自然度 / 辅助创作。**请勿用于刷量、控评或伪装真人水军**，
> 遵守各平台协议及《反不正当竞争法》《电子商务法》。

## 技术栈（已确认）
- **Flutter 单一代码库**：一套 `lib/` 逻辑，三端共用。
- **直连云端 LLM API**：OpenAI / DeepSeek（官方）/ 通义千问 / 文心一言 均走 OpenAI 兼容协议，无自建服务器。
- 内置 **Demo 模式（MockLlmClient）**：不填密钥也能跑通 UI，先看效果。

## 目录结构
```
lib/
  main.dart                 # 入口（三端共用）
  state/app_state.dart      # 全局状态（provider）
  ui/home_page.dart         # 主界面（三端共用）
  core/
    persona/                # 人设模型 + 预置人设
    llm/                    # LLM 配置 + 客户端（OpenAI 兼容 / Mock）
    corpus/                 # 真人语料 few-shot 检索（MVP 内置示例）
    postprocess/            # 后处理规则（去模板词/语气词/emoji）
    quality/                # 质量评分（启发式 + 大模型 G-Eval 自评）
    pipeline/               # 拟人化流水线：生成→后处理→质量闸门
    prompts.dart            # 去 AI 味提示词模板
```

## 运行（Web，最快看到效果）
```powershell
cd ai_humanizer
flutter pub get
flutter run -d chrome
```
浏览器打开后：输入一条 AI 味评论 → 选人设 → 点「拟人化」。
默认 Demo 模式即可出结果；想接真实模型，展开「大模型配置」选提供方并填 Key。

## 出三端包
### 网页
```powershell
flutter build web --release
# 产物在 build/web/，可直接静态托管；本地预览：
python -m http.server -d build/web 8080
```
### Android APK
```powershell
flutter create --platforms=android .   # 首次补齐 android/ 工程
flutter build apk --release            # 产物 build/app/outputs/flutter-apk/app-release.apk
```
### 便携桌面（Windows / Linux）
```powershell
flutter config --enable-windows-desktop
flutter config --enable-linux-desktop
flutter create --platforms=windows,linux .
# Windows
flutter build windows --release   # 产物在 build/windows/x64/runner/Release/
# Linux
flutter build linux --release     # 产物在 build/linux/x64/release/bundle/
```
> 便携化：把对应 `Release/`（Windows）或 `bundle/`（Linux）整个目录拷到任意机器即可运行，
> 数据存同目录，不写注册表。若要"单文件"，可用 `flutter_distributor` 或 `enigma virtual box` 进一步打包。

## 接入真实大模型
UI「大模型配置」中选择提供方，填 API Key（仅存于本次会话内存，Web 端不落盘）。
- OpenAI：默认 `gpt-4o-mini`
- DeepSeek（官方）：默认 `deepseek-v4-flash`（Base URL `https://api.deepseek.com`，OpenAI 兼容；可选 `deepseek-v4-pro` 旗舰 / `deepseek-v4-flash-vision-exp` 实验性多模态）
- 通义千问：默认 `qwen-plus`（DashScope 兼容模式）
- 文心一言：默认 `ernie-4.0-8k`（千帆兼容模式）

移动 / 桌面端建议后续接入 `flutter_secure_storage` 持久化密钥（本项目 MVP 暂用会话内存）。

## 评测体系（来自调研报告）
人味评分 = 启发式（突发性 40% + 自然度 60%）；勾选「用大模型自评」后叠加 G-Eval（占 70%）。
阈值默认 70，未达标自动重写（最多 1 次，可上调 `maxRetries`）。

## 已落地里程碑
- M1：Flutter 工程脚手架（一套 Dart 出三端）。
- M2：核心库（persona / llm / corpus / postprocess / quality / pipeline）+ Web 端可运行。
- M3：质检闭环（启发式评分 + 大模型 G-Eval 自评，UI 一键开关，阈值见 `HumanizeOptions.threshold`）。
- M4：三端 UI 贯通——**人设编辑器**（新建/编辑，含喂给提示词的语言风格）、**历史记录**（内存，可清空/导出 JSON 到剪贴板）、**分享/导出**（结果一键复制、历史导出 JSON）。
- M5：真人语料 few-shot 检索——`CorpusStore` 重写为基于中文 n-gram 相似度的轻量检索（纯 Dart、无需分词库/联网）；支持粘贴 **MediaCrawler 导出的匿名化评论 JSON** 扩充范例（字段宽容匹配 content/tag/source/likes 等）；内置 18 条多品类匿名化种子；UI 新增「语料库」卡片（导入/重置/条数），检索按人设平台优先同平台范例。
- M6：本地持久化（三端通用）——人设 / 历史 / 语料自定义部分经 `shared_preferences` 落盘，重启保留；语料导入支持**文件选择**（`file_picker`，JSON/TXT/CSV，Web 端用 `<input type=file>`）。API Key 一并持久化（注：Web 浏览器存储非真加密，生产环境移动/桌面建议换 `flutter_secure_storage`）。

## 后续可选增强
- 密钥安全：移动 / 桌面接 `flutter_secure_storage`（当前 Web 端因浏览器限制仅用 `shared_preferences`）。
- 打包发布脚本（APK / Windows / Web 静态托管）。
- 语料去重与规模化（万级语料时改向量检索）。
