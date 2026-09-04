import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:file_picker/file_picker.dart';
import 'package:provider/provider.dart';
import '../core/llm/llm_config.dart';
import '../core/persona/persona.dart';
import '../state/app_state.dart';
import '../core/pipeline/pipeline.dart';
import 'persona_editor_page.dart';
import 'widgets/quality_gauge.dart';

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(7),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.primary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(Icons.auto_awesome, size: 18, color: Theme.of(context).colorScheme.primary),
              ),
              const SizedBox(width: 10),
              const Text('AI 评论拟人化工具'),
            ],
          ),
          actions: const [
            Padding(
              padding: EdgeInsets.only(right: 16),
              child: Center(
                child: Chip(label: Text('M5 · 真人语料检索')),
              ),
            )
          ],
        ),
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1080),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final wide = constraints.maxWidth >= 900;
                  final left = const _InputColumn();
                  final right = const _OutputColumn();
                  if (wide) {
                    return Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(flex: 5, child: left),
                        const SizedBox(width: 20),
                        Expanded(flex: 6, child: right),
                      ],
                    );
                  }
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [left, const SizedBox(height: 20), right],
                  );
                },
              ),
            ),
          ),
        ),
      );
}

/// 左栏：人设 + 输入 + 语料 + 配置。
class _InputColumn extends StatelessWidget {
  const _InputColumn();

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: const [
          _InputCard(),
          SizedBox(height: 16),
          _CorpusCard(),
          SizedBox(height: 16),
          _SettingsCard(),
        ],
      );
}

/// 右栏：结果 + 历史 + 合规声明。
class _OutputColumn extends StatelessWidget {
  const _OutputColumn();

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: const [
          _ResultArea(),
          SizedBox(height: 16),
          _HistorySection(),
          SizedBox(height: 16),
          _ComplianceNote(),
        ],
      );
}

/// 通用分区标题。
class _SectionTitle extends StatelessWidget {
  final String text;
  final IconData? icon;
  const _SectionTitle(this.text, {this.icon});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Row(
          children: [
            if (icon != null) ...[
              Icon(icon, size: 16, color: Theme.of(context).colorScheme.primary),
              const SizedBox(width: 6),
            ],
            Text(text, style: Theme.of(context).textTheme.titleMedium),
          ],
        ),
      );
}

/// 输入卡片：人设选择 + 评论输入框 + 拟人化主按钮 + 自评开关。
class _InputCard extends StatelessWidget {
  const _InputCard();

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _SectionTitle('人设与输入', icon: Icons.edit_note),
            _PersonaSelector(state: state),
            const SizedBox(height: 14),
            TextField(
              maxLines: 5,
              decoration: const InputDecoration(
                labelText: '输入一条 AI 味很重的评论',
                hintText: '例如：这款产品非常好，首先它的质量很高，其次价格合理，总之值得购买。',
                alignLabelWithHint: true,
              ),
              onChanged: state.setInput,
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 14,
              runSpacing: 10,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                ElevatedButton.icon(
                  onPressed: state.busy
                      ? null
                      : (state.input.trim().isEmpty ? null : state.humanize),
                  icon: state.busy
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.auto_fix_high),
                  label: Text(state.busy ? '拟人化中…' : '拟人化'),
                ),
                InkWell(
                  borderRadius: BorderRadius.circular(10),
                  onTap: () => state.setUseLlmJudge(!state.useLlmJudge),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Checkbox(
                          value: state.useLlmJudge,
                          visualDensity: VisualDensity.compact,
                          materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          onChanged: (v) => state.setUseLlmJudge(v ?? false),
                        ),
                        const Text('用大模型自评（更准，消耗 API）', style: TextStyle(fontSize: 13)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PersonaSelector extends StatelessWidget {
  final AppState state;
  const _PersonaSelector({required this.state});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: DropdownButtonFormField<Persona>(
            value: state.persona,
            decoration: const InputDecoration(labelText: '选择人设', contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 10)),
            items: state.personas
                .map((p) => DropdownMenuItem(value: p, child: Text('${p.name}（${p.description}）')))
                .toList(),
            onChanged: (p) => state.setPersona(p!),
          ),
        ),
        const SizedBox(width: 8),
        IconButton.filledTonal(
          tooltip: '编辑当前人设',
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => PersonaEditorPage(initial: state.persona)),
          ),
          icon: const Icon(Icons.edit),
        ),
        IconButton.filledTonal(
          tooltip: '新建人设',
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const PersonaEditorPage()),
          ),
          icon: const Icon(Icons.add),
        ),
      ],
    );
  }
}

class _SettingsCard extends StatelessWidget {
  const _SettingsCard();

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final cfg = state.config;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _SectionTitle('大模型配置', icon: Icons.tune),
            Text('留空则用内置 Demo 模式（不联网）', style: Theme.of(context).textTheme.labelMedium),
            const SizedBox(height: 12),
            DropdownButtonFormField<LlmProvider>(
              value: cfg.provider,
              decoration: const InputDecoration(labelText: '提供方', contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 10)),
              items: const [
                DropdownMenuItem(value: LlmProvider.mock, child: Text('Demo 模式（不联网）')),
                DropdownMenuItem(value: LlmProvider.openai, child: Text('OpenAI')),
                DropdownMenuItem(value: LlmProvider.deepseek, child: Text('DeepSeek（官方）')),
                DropdownMenuItem(value: LlmProvider.tongyi, child: Text('通义千问')),
                DropdownMenuItem(value: LlmProvider.wenxin, child: Text('文心一言')),
              ],
              onChanged: (p) => state.setConfig(_defaultConfig(p!)),
            ),
            if (!cfg.isMock) ...[
              const SizedBox(height: 10),
              TextField(
                decoration: const InputDecoration(labelText: 'API Key（仅存于本次会话）'),
                obscureText: true,
                onChanged: (v) => state.setConfig(cfg.copyWith(apiKey: v.trim())),
              ),
              const SizedBox(height: 10),
              TextField(
                decoration: const InputDecoration(labelText: '模型名（可选，有默认值）'),
                controller: TextEditingController(text: cfg.model),
                onChanged: (v) => state.setConfig(cfg.copyWith(model: v.trim())),
              ),
              const SizedBox(height: 10),
              TextField(
                decoration: const InputDecoration(labelText: 'Base URL（可选，有默认值）'),
                controller: TextEditingController(text: cfg.baseUrl),
                onChanged: (v) => state.setConfig(cfg.copyWith(baseUrl: v.trim())),
              ),
            ],
          ],
        ),
      ),
    );
  }

  LlmConfig _defaultConfig(LlmProvider p) {
    switch (p) {
      case LlmProvider.openai:
        return LlmConfig.openai('');
      case LlmProvider.deepseek:
        return LlmConfig.deepseek('');
      case LlmProvider.tongyi:
        return LlmConfig.tongyi('');
      case LlmProvider.wenxin:
        return LlmConfig.wenxin('');
      case LlmProvider.mock:
        return LlmConfig.mock();
    }
  }
}

/// 结果区：空态引导 / 加载中 / 错误态 / 正常结果（含评分可视化 + 前后对比）。
class _ResultArea extends StatelessWidget {
  const _ResultArea();

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    if (state.busy) {
      return Card(
        child: SizedBox(
          height: 260,
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const CircularProgressIndicator(),
                const SizedBox(height: 14),
                Text('正在拟人化，请稍候…', style: Theme.of(context).textTheme.bodyMedium),
              ],
            ),
          ),
        ),
      );
    }
    final r = state.result;
    if (r == null) {
      return Card(
        child: SizedBox(
          height: 260,
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.lightbulb_outline, size: 40, color: Colors.grey.shade400),
                  const SizedBox(height: 14),
                  Text('在左侧输入 AI 味评论，点击「拟人化」查看结果',
                      textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium),
                ],
              ),
            ),
          ),
        ),
      );
    }
    if (r.isError) {
      return Card(
        color: Colors.red.shade50,
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            children: [
              const Icon(Icons.error_outline, color: Colors.red),
              const SizedBox(width: 10),
              Expanded(child: Text('⚠️ ${r.quality.note}', style: const TextStyle(color: Colors.red))),
            ],
          ),
        ),
      );
    }
    return _ResultCard(result: r);
  }
}

class _ResultCard extends StatelessWidget {
  final HumanizeResult result;
  const _ResultCard({required this.result});

  @override
  Widget build(BuildContext context) {
    final q = result.quality;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const _SectionTitle('人味评分'),
                const Spacer(),
                Chip(label: Text('重写 ${result.iterations} 次')),
                const SizedBox(width: 8),
                FilledButton.tonalIcon(
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: result.humanized));
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('已复制结果')));
                  },
                  icon: const Icon(Icons.copy, size: 16),
                  label: const Text('复制'),
                ),
              ],
            ),
            const SizedBox(height: 10),
            QualityGauge(
              total: q.total,
              burstiness: q.burstiness,
              naturalness: q.naturalness,
              humanlikeness: q.humanlikeness,
              note: q.note,
            ),
            if (q.note.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text('评测说明：${q.note}', style: Theme.of(context).textTheme.labelMedium),
            ],
            const SizedBox(height: 16),
            const Divider(),
            const SizedBox(height: 12),
            _CompareBlock(
              label: '改写前',
              text: result.original,
              accent: Colors.grey,
            ),
            const SizedBox(height: 12),
            _CompareBlock(
              label: '改写后',
              text: result.humanized,
              accent: const Color(0xFF16A34A),
              highlight: true,
            ),
          ],
        ),
      ),
    );
  }
}

/// 前后对比文本块。
class _CompareBlock extends StatelessWidget {
  final String label;
  final String text;
  final Color accent;
  final bool highlight;
  const _CompareBlock({
    required this.label,
    required this.text,
    required this.accent,
    this.highlight = false,
  });

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: highlight ? accent.withOpacity(0.06) : const Color(0xFFF3F4F6),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: highlight ? accent.withOpacity(0.25) : Colors.transparent, width: 1),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.circle, size: 8, color: accent),
                const SizedBox(width: 6),
                Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: accent)),
              ],
            ),
            const SizedBox(height: 6),
            SelectableText(text, style: TextStyle(fontSize: highlight ? 15 : 14, color: highlight ? const Color(0xFF111827) : const Color(0xFF4B5563))),
          ],
        ),
      );
}

class _HistorySection extends StatelessWidget {
  const _HistorySection();

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    if (state.history.isEmpty) return const SizedBox.shrink();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                _SectionTitle('历史（${state.history.length}）'),
                const Spacer(),
                TextButton(onPressed: state.clearHistory, child: const Text('清空')),
                TextButton(
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: state.exportHistoryJson()));
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('历史 JSON 已复制')));
                  },
                  child: const Text('导出 JSON'),
                ),
              ],
            ),
            const Divider(),
            ...state.history.take(10).map((r) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Chip(label: Text('${r.quality.total.toInt()}')),
                  title: SelectableText(r.humanized, style: const TextStyle(fontSize: 14)),
                  subtitle: Text('原：${r.original}', maxLines: 1, overflow: TextOverflow.ellipsis),
                )),
          ],
        ),
      ),
    );
  }
}

class _ComplianceNote extends StatelessWidget {
  const _ComplianceNote();
  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.only(top: 4, left: 4),
        child: Text(
          '合规声明：本工具用于提升自有内容的自然度 / 辅助创作。'
          '请勿用于刷量、控评或伪装真人水军，遵守平台协议与《反不正当竞争法》《电子商务法》。',
          style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12, height: 1.6),
        ),
      );
}

class _CorpusCard extends StatefulWidget {
  const _CorpusCard();
  @override
  State<_CorpusCard> createState() => _CorpusCardState();
}

class _CorpusCardState extends State<_CorpusCard> {
  final _ctl = TextEditingController();

  @override
  void dispose() {
    _ctl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const _SectionTitle('真人语料库（few-shot 检索）'),
                const Spacer(),
                Chip(label: Text('已载入 ${state.corpusCount} 条')),
              ],
            ),
            const SizedBox(height: 6),
            const Text(
              '可粘贴 MediaCrawler 导出的评论 JSON（数组，字段含 content/tag/source/likes 等）来扩充真人范例，提升人味。'
              '导入内容仅存内存、需自行完成匿名化与合规校验。',
              style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12, height: 1.6),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _ctl,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: '粘贴语料 JSON（可选，留空用内置种子）',
                hintText: '[{"content":"真好看啊姐妹们","tag":"穿搭","source":"小红书","likes":320}]',
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 12,
              runSpacing: 8,
              children: [
                ElevatedButton.icon(
                  onPressed: () async {
                    final txt = _ctl.text.trim();
                    if (txt.isEmpty) return;
                    final n = await state.importCorpus(txt);
                    _ctl.clear();
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('已导入 $n 条语料')));
                    }
                  },
                  icon: const Icon(Icons.upload, size: 16),
                  label: const Text('导入语料'),
                ),
                OutlinedButton.icon(
                  onPressed: () async {
                    final res = await FilePicker.pickFiles(
                      type: FileType.custom,
                      allowedExtensions: ['json', 'txt', 'csv'],
                    );
                    if (res.isEmpty) return;
                    final bytes = await res.first.readAsBytes();
                    final content = utf8.decode(bytes);
                    try {
                      final n = await state.importCorpus(content);
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('已导入 $n 条语料')));
                      }
                    } catch (e) {
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('导入失败：$e')));
                      }
                    }
                  },
                  icon: const Icon(Icons.folder_open, size: 16),
                  label: const Text('选择文件'),
                ),
                TextButton(
                  onPressed: state.resetCorpus,
                  child: const Text('恢复内置种子'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
