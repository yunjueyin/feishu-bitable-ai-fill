import '../persona/persona.dart';
import '../llm/llm_client.dart';
import '../corpus/corpus.dart';
import '../postprocess/postprocess.dart';
import '../quality/quality.dart';
import '../prompts.dart';

/// 由人设名推断语料检索平台（优先同平台真人范例）。
String? _platformOf(String personaName) {
  if (personaName.contains('小红书')) return '小红书';
  if (personaName.contains('抖音')) return '抖音';
  return null;
}

/// 拟人化选项。
class HumanizeOptions {
  final Persona persona;
  final PostprocessOptions post;
  final double threshold; // 质量闸门阈值（0-100）
  final int maxRetries; // 自评不达标时最多重写次数
  final bool useLlmJudge; // 是否用大模型自评（否则仅启发式）

  HumanizeOptions({
    required this.persona,
    this.post = const PostprocessOptions(),
    this.threshold = 70,
    this.maxRetries = 1,
    this.useLlmJudge = false,
  });
}

/// 拟人化结果。
class HumanizeResult {
  final String original;
  final String humanized;
  final QualityScore quality;
  final int iterations;
  final bool isError;

  HumanizeResult({
    required this.original,
    required this.humanized,
    required this.quality,
    this.iterations = 1,
    this.isError = false,
  });

  factory HumanizeResult.error(String msg, String original) => HumanizeResult(
        original: original,
        humanized: '',
        quality: QualityScore.error(msg),
        isError: true,
      );

  Map<String, dynamic> toJson() => {
        'original': original,
        'humanized': humanized,
        'quality': quality.toJson(),
        'iterations': iterations,
        'isError': isError,
      };

  factory HumanizeResult.fromJson(Map<String, dynamic> j) => HumanizeResult(
        original: j['original'] as String? ?? '',
        humanized: j['humanized'] as String? ?? '',
        quality: QualityScore.fromJson(j['quality'] as Map<String, dynamic>? ?? {}),
        iterations: (j['iterations'] as num?)?.toInt() ?? 1,
        isError: j['isError'] as bool? ?? false,
      );
}

/// 拟人化流水线：生成 → 后处理 → 质量闸门（自评不达标则重写）。
class Humanizer {
  final LlmClient client;
  final CorpusStore corpus;
  final QualityJudge judge;

  Humanizer({
    required this.client,
    CorpusStore? corpus,
    QualityJudge? judge,
  })  : corpus = corpus ?? CorpusStore(),
        judge = judge ?? HeuristicQualityJudge();

  Future<HumanizeResult> humanize(String input, HumanizeOptions opts) async {
    final text = input.trim();
    if (text.isEmpty) {
      return HumanizeResult.error('输入为空', input);
    }
    final platform = _platformOf(opts.persona.name);
    final examples = corpus.retrieve(text, k: 3, platform: platform);
    final system = buildSystemPrompt(opts.persona, examples);
    String userPrompt = buildUserPrompt(text);
    String feedback = '';

    for (int i = 0; i <= opts.maxRetries; i++) {
      String raw;
      try {
        raw = await client.generate(system, userPrompt + feedback);
      } catch (e) {
        return HumanizeResult.error('大模型调用失败：$e', input);
      }
      final processed = postprocess(raw, opts.persona, opts.post);
      final q = await judge.score(text, processed, opts.persona);

      if (q.total >= opts.threshold || i == opts.maxRetries) {
        return HumanizeResult(
          original: input,
          humanized: processed,
          quality: q,
          iterations: i + 1,
        );
      }
      // 不达标：把自评意见喂回去重写
      feedback = retryFeedback;
    }
    // 理论上不会到这（循环必返回），兜底
    return HumanizeResult.error('未产出结果', input);
  }
}
