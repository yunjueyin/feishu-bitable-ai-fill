import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/persona/persona.dart';
import '../state/app_state.dart';

/// 人设编辑/新建页（三端通用）。字段含喂给提示词的"语言风格"。
class PersonaEditorPage extends StatefulWidget {
  final Persona? initial;
  const PersonaEditorPage({super.key, this.initial});

  @override
  State<PersonaEditorPage> createState() => _PersonaEditorPageState();
}

class _PersonaEditorPageState extends State<PersonaEditorPage> {
  late final TextEditingController _name;
  late final TextEditingController _desc;
  late final TextEditingController _tone;
  late final TextEditingController _emotion;
  late final TextEditingController _style;
  late final TextEditingController _catch;
  late final TextEditingController _fillers;
  late final TextEditingController _emojis;

  @override
  void initState() {
    super.initState();
    final p = widget.initial;
    _name = TextEditingController(text: p?.name ?? '');
    _desc = TextEditingController(text: p?.description ?? '');
    _tone = TextEditingController(text: p?.tone ?? '');
    _emotion = TextEditingController(text: p?.emotionalStyle ?? '');
    _style = TextEditingController(text: p?.speakingStyle ?? '');
    _catch = TextEditingController(text: p?.catchphrases.join(' / '));
    _fillers = TextEditingController(text: p?.fillers.join(' / '));
    _emojis = TextEditingController(text: p?.emojis.join(' '));
  }

  @override
  void dispose() {
    for (final c in [_name, _desc, _tone, _emotion, _style, _catch, _fillers, _emojis]) {
      c.dispose();
    }
    super.dispose();
  }

  List<String> _split(String s, [Pattern sep = ' / ']) =>
      s.split(sep).map((e) => e.trim()).where((e) => e.isNotEmpty).toList();

  void _save() {
    final state = context.read<AppState>();
    final p = widget.initial;
    final persona = Persona(
      id: p?.id ?? 'custom_${DateTime.now().millisecondsSinceEpoch}',
      name: _name.text.trim().isEmpty ? '自定义人设' : _name.text.trim(),
      description: _desc.text.trim(),
      tone: _tone.text.trim(),
      catchphrases: _split(_catch.text),
      fillers: _split(_fillers.text),
      emojis: _split(_emojis.text, ' '),
      emotionalStyle: _emotion.text.trim(),
      speakingStyle: _style.text.trim(),
    );
    state.updatePersona(persona);
    Navigator.of(context).pop();
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('已保存「${persona.name}」')));
  }

  Widget _field(String label, TextEditingController c, {int lines = 1, String? helper}) => Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: TextField(
          controller: c,
          maxLines: lines,
          decoration: InputDecoration(
            labelText: label,
            alignLabelWithHint: lines > 1,
            helperText: helper,
            helperMaxLines: 2,
          ),
        ),
      );

  Widget _group({required String title, required IconData icon, required List<Widget> children}) => Card(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Icon(icon, size: 16, color: Theme.of(context).colorScheme.primary),
                  const SizedBox(width: 6),
                  Text(title, style: Theme.of(context).textTheme.titleMedium),
                ],
              ),
              const SizedBox(height: 14),
              ...children,
            ],
          ),
        ),
      );

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: Text(widget.initial == null ? '新建人设' : '编辑人设'),
          actions: [
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: FilledButton.icon(
                onPressed: _save,
                icon: const Icon(Icons.check, size: 16),
                label: const Text('保存'),
              ),
            )
          ],
        ),
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _group(
                    title: '基础信息',
                    icon: Icons.badge_outlined,
                    children: [
                      _field('名称', _name),
                      _field('描述', _desc),
                    ],
                  ),
                  const SizedBox(height: 16),
                  _group(
                    title: '风格细节',
                    icon: Icons.emoji_emotions_outlined,
                    children: [
                      _field('语气', _tone),
                      _field('情感风格', _emotion),
                      _field('语言风格（喂给提示词，越具体越有人味）', _style, lines: 3),
                      _field('口头禅（用 " / " 分隔）', _catch),
                      _field('语气词（用 " / " 分隔）', _fillers),
                      _field('emoji（用空格分隔）', _emojis),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const Text('保存后可在主页下拉框选择该人设。',
                      style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                ],
              ),
            ),
          ),
        ),
      );
}
