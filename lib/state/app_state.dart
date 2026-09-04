import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import '../core/persona/persona.dart';
import '../core/persona/preset_personas.dart';
import '../core/llm/llm_config.dart';
import '../core/llm/llm_client.dart';
import '../core/quality/quality.dart';
import '../core/corpus/corpus.dart';
import '../core/pipeline/pipeline.dart';

/// 全局状态：配置、人设、语料、输入、结果、历史；M6 起全部本地持久化（path_provider + 本地 JSON 文件，三端通用）。
class AppState extends ChangeNotifier {
  AppState() {
    _init();
  }

  Future<void> _init() async {
    await _load();
  }

  LlmConfig _config = LlmConfig.mock();
  LlmConfig get config => _config;
  void setConfig(LlmConfig c) {
    _config = c;
    notifyListeners();
    _persistConfig();
  }

  Persona _persona = PresetPersonas.xiaohongshu;
  Persona get persona => _persona;
  void setPersona(Persona p) {
    _persona = p;
    notifyListeners();
  }

  /// 可编辑/可新增的人设列表（预置 + 自定义，持久化）。
  List<Persona> _personas = List<Persona>.from(PresetPersonas.all);
  List<Persona> get personas => _personas;

  void updatePersona(Persona p) {
    final i = _personas.indexWhere((e) => e.id == p.id);
    if (i >= 0) {
      _personas[i] = p;
    } else {
      _personas.add(p);
    }
    if (_persona.id == p.id) _persona = p; // 保持当前选中
    notifyListeners();
    _save();
  }

  /// 真人语料库（M5）：内置匿名化种子 + 用户导入的 MediaCrawler 导出（持久化自定义部分）。
  CorpusStore _corpus = CorpusStore();
  CorpusStore get corpus => _corpus;
  int get corpusCount => _corpus.count;
  Future<int> importCorpus(String raw) async {
    final trimmed = raw.trim();
    int n;
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      n = _corpus.importJson(raw);
    } else {
      n = 0;
      for (final line in trimmed.split(RegExp(r'[\r\n]+'))) {
        final t = line.trim();
        if (t.isNotEmpty) {
          _corpus.examples.add(CorpusExample(t));
          n++;
        }
      }
      if (n == 0) throw const FormatException('未解析到任何内容');
    }
    notifyListeners();
    await _save();
    return n;
  }

  void resetCorpus() {
    _corpus = CorpusStore();
    notifyListeners();
    _save();
  }

  String _input = '';
  String get input => _input;
  void setInput(String v) {
    _input = v;
    notifyListeners();
  }

  HumanizeResult? _result;
  HumanizeResult? get result => _result;

  bool _busy = false;
  bool get busy => _busy;

  bool _useLlmJudge = false;
  bool get useLlmJudge => _useLlmJudge;
  void setUseLlmJudge(bool v) {
    _useLlmJudge = v;
    notifyListeners();
  }

  /// 历史记录（最近在前，持久化，最多保留 100 条）。
  List<HumanizeResult> _history = [];
  List<HumanizeResult> get history => _history;

  void clearHistory() {
    _history.clear();
    notifyListeners();
    _save();
  }

  String exportHistoryJson() {
    final list = _history
        .map((r) => {
              'original': r.original,
              'humanized': r.humanized,
              'score': r.quality.total,
              'iterations': r.iterations,
            })
        .toList();
    return const JsonEncoder.withIndent('  ').convert(list);
  }

  Future<void> humanize() async {
    final text = _input.trim();
    if (text.isEmpty || _busy) return;
    _busy = true;
    _result = null;
    notifyListeners();
    try {
      final client = _config.isMock
          ? MockLlmClient()
          : OpenAiCompatibleClient(_config);
      final judge = (_useLlmJudge && !_config.isMock)
          ? LlmQualityJudge(client)
          : HeuristicQualityJudge();
      final humanizer = Humanizer(client: client, corpus: _corpus, judge: judge);
      _result = await humanizer.humanize(
        text,
        HumanizeOptions(persona: _persona, useLlmJudge: _useLlmJudge && !_config.isMock),
      );
      if (!_result!.isError) {
        _history.insert(0, _result!);
        if (_history.length > 100) _history.length = 100;
      }
    } catch (e) {
      _result = HumanizeResult.error('出错：$e', text);
    } finally {
      _busy = false;
      notifyListeners();
      await _save();
    }
  }

  // ---- 本地持久化（path_provider + 本地 JSON 文件，三端通用）----
  Future<File> get _storeFile async {
    final dir = await getApplicationSupportDirectory();
    return File('${dir.path}/ai_humanizer_state.json');
  }

  Future<void> _load() async {
    try {
      final file = await _storeFile;
      if (!await file.exists()) return;
      final map = jsonDecode(await file.readAsString()) as Map<String, dynamic>;
      final personasJson = map['personas'];
      if (personasJson != null) {
        try {
          final list = personasJson as List;
          _personas = list.map((e) => Persona.fromJson(e as Map<String, dynamic>)).toList();
        } catch (_) {}
      }
      final historyJson = map['history'];
      if (historyJson != null) {
        try {
          final list = historyJson as List;
          _history =
              list.map((e) => HumanizeResult.fromJson(e as Map<String, dynamic>)).toList();
        } catch (_) {}
      }
      final corpusJson = map['corpus'];
      if (corpusJson != null) {
        try {
          final list = corpusJson as List;
          for (final e in list) {
            _corpus.examples.add(CorpusExample.fromJson(e as Map<String, dynamic>));
          }
        } catch (_) {}
      }
      final apiKey = map['api_key'];
      if (apiKey != null && apiKey is String && apiKey.isNotEmpty) {
        _config = _config.copyWith(apiKey: apiKey);
      }
    } catch (_) {}
    notifyListeners();
  }

  Future<void> _save() async {
    try {
      final file = await _storeFile;
      await file.parent.create(recursive: true);
      await file.writeAsString(jsonEncode({
        'personas': _personas.map((e) => e.toJson()).toList(),
        'history': _history.map((e) => e.toJson()).toList(),
        'corpus': _corpus.customExamples.map((e) => e.toJson()).toList(),
        'api_key': _config.apiKey,
      }));
    } catch (_) {}
  }

  Future<void> _persistConfig() async {
    await _save();
  }
}
