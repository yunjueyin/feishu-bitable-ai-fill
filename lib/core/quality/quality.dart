import 'dart:convert';
import '../persona/persona.dart';
import '../llm/llm_client.dart';
import '../prompts.dart';

/// 质量评分结果（0-100）。
class QualityScore {
  final double total;
  final double burstiness; // 句长多样性（越高越自然）
  final double naturalness; // 模板词惩罚后的自然度
  final double humanlikeness; // 大模型自评分（如有）
  final String note;

  const QualityScore({
    required this.total,
    this.burstiness = 0,
    this.naturalness = 0,
    this.humanlikeness = 0,
    this.note = '',
  });

  factory QualityScore.error(String msg) => QualityScore(total: 0, note: msg);

  Map<String, dynamic> toJson() => {
        'total': total,
        'burstiness': burstiness,
        'naturalness': naturalness,
        'humanlikeness': humanlikeness,
        'note': note,
      };

  factory QualityScore.fromJson(Map<String, dynamic> j) => QualityScore(
        total: (j['total'] as num?)?.toDouble() ?? 0,
        burstiness: (j['burstiness'] as num?)?.toDouble() ?? 0,
        naturalness: (j['naturalness'] as num?)?.toDouble() ?? 0,
        humanlikeness: (j['humanlikeness'] as num?)?.toDouble() ?? 0,
        note: j['note'] as String? ?? '',
      );
}

/// 评分裁判：启发式（必有）+ 大模型自评（可选）。
abstract class QualityJudge {
  Future<QualityScore> score(String input, String output, Persona persona);
}

/// 启发式评分：可离线、零成本，作为质量闸门基础。
class HeuristicQualityJudge implements QualityJudge {
  @override
  Future<QualityScore> score(String input, String output, Persona persona) async {
    final sents = output
        .split(RegExp(r'[。！？!?]'))
        .where((s) => s.trim().isNotEmpty)
        .toList();
    // 突发性：句长方差（归一化）
    double burst = 0;
    if (sents.length > 1) {
      final lens = sents.map((s) => s.length).toList();
      final mean = lens.reduce((a, b) => a + b) / lens.length;
      final variance = lens.map((l) => (l - mean) * (l - mean)).reduce((a, b) => a + b) / lens.length;
      burst = (variance / (mean * mean + 1)).clamp(0.0, 1.0);
    }
    // 自然度：模板词惩罚 + 语气词/emoji 奖励
    final templateHits = _templateWords.where((w) => output.contains(w)).length;
    final hasFiller = persona.fillers.any((f) => output.contains(f));
    final hasEmoji = RegExp(r'[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]', unicode: true).hasMatch(output);
    final naturalness = (100.0 - templateHits * 25 + (hasFiller ? 10 : 0) + (hasEmoji ? 10 : 0))
        .clamp(0.0, 100.0);
    final total = (burst * 100 * 0.4 + naturalness * 0.6).clamp(0.0, 100.0);
    return QualityScore(
      total: total,
      burstiness: burst * 100,
      naturalness: naturalness,
      note: templateHits > 0 ? '仍有${templateHits}处模板词' : '无明显模板词',
    );
  }

  static const _templateWords = [
    '首先',
    '其次',
    '然后',
    '最后',
    '综上所述',
    '总之',
    '因此',
    '此外',
    '值得注意的是',
    '总体而言',
  ];
}

/// 大模型自评（G-Eval 风格），失败回退到启发式。
class LlmQualityJudge implements QualityJudge {
  final LlmClient client;
  LlmQualityJudge(this.client);

  @override
  Future<QualityScore> score(String input, String output, Persona persona) async {
    try {
      final raw = await client.generate(judgeSystem, buildJudgePrompt(input, output, persona));
      final score = _parseScore(raw);
      final base = await HeuristicQualityJudge().score(input, output, persona);
      final total = (score * 10 * 0.7 + base.total * 0.3).clamp(0.0, 100.0);
      return QualityScore(
        total: total,
        burstiness: base.burstiness,
        naturalness: base.naturalness,
        humanlikeness: score * 10,
        note: '大模型自评 $score/10；${base.note}',
      );
    } catch (_) {
      return HeuristicQualityJudge().score(input, output, persona);
    }
  }

  double _parseScore(String raw) {
    final start = raw.indexOf('{');
    final end = raw.lastIndexOf('}');
    if (start < 0 || end < 0) return 5;
    final json = jsonDecode(raw.substring(start, end + 1)) as Map<String, dynamic>;
    final s = (json['score'] as num?)?.toDouble() ?? 5;
    return s.clamp(1.0, 10.0);
  }
}
