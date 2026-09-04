import 'dart:convert';
import 'dart:math';

/// 一条真人评论语料（匿名化）。
class CorpusExample {
  final String text;
  final List<String> tags;
  final String domain; // 平台/领域：小红书 / 抖音 / 通用
  final int heat; // 热度（可选，检索时轻微加权，鼓励更自然的范本）

  const CorpusExample(
    this.text, [
    this.tags = const [],
    this.domain = '通用',
    this.heat = 0,
  ]);

  Map<String, dynamic> toJson() => {
        'text': text,
        'tags': tags,
        'domain': domain,
        'heat': heat,
      };

  factory CorpusExample.fromJson(Map<String, dynamic> j) => CorpusExample(
        j['text'] as String,
        List<String>.from(j['tags'] ?? const []),
        j['domain'] as String? ?? '通用',
        (j['heat'] as num?)?.toInt() ?? 0,
      );
}

/// 真人语料库：基于中文 n-gram 相似度的轻量 few-shot 检索（纯 Dart，无需分词库/联网）。
///
/// 扩充方式：
/// - 内置 [seed]（匿名化合成风格，覆盖多品类）；
/// - [importJson] 解析 MediaCrawler 等导出的评论 JSON 数组，字段宽容匹配：
///   content/text/comment/body/正文、tag/tags/category/标签、source/platform/domain/平台、
///   likes/like_count/favorite_count/hot/点赞。
class CorpusStore {
  final List<CorpusExample> examples;

  CorpusStore([List<CorpusExample>? examples])
      : examples = examples ?? List.of(_seed);

  int get count => examples.length;

  /// 仅用户导入的语料（排除内置种子），用于持久化时避免种子重复写入。
  List<CorpusExample> get customExamples =>
      examples.where((e) => !_seed.contains(e)).toList();

  /// 轻量中文分词：取去空白后的字符 2-gram（对中文友好，无需外部分词库）。
  static Map<String, int> _ngramFreq(String s) {
    s = s.replaceAll(RegExp(r'\s+'), '');
    final m = <String, int>{};
    if (s.isEmpty) return m;
    if (s.length == 1) {
      m[s] = 1;
      return m;
    }
    for (var i = 0; i < s.length - 1; i++) {
      final g = s.substring(i, i + 2);
      m[g] = (m[g] ?? 0) + 1;
    }
    return m;
  }

  /// 余弦相似度（基于 n-gram 词频向量）。
  static double _cosine(Map<String, int> a, Map<String, int> b) {
    double dot = 0, na = 0, nb = 0;
    for (final e in a.entries) {
      na += e.value * e.value;
      final bv = b[e.key];
      if (bv != null) dot += e.value * bv;
    }
    for (final e in b.entries) nb += e.value * e.value;
    if (na == 0 || nb == 0) return 0;
    return dot / (sqrt(na) * sqrt(nb));
  }

  /// 按与 query 的语义近似度返回 top-k 真人评论作为 few-shot 范例。
  /// [platform] 非空时优先同平台语料（并保留「通用」兜底）。
  List<CorpusExample> retrieve(String query, {int k = 3, String? platform}) {
    final q = _ngramFreq(query);
    final scored = <CorpusExample, double>{};
    for (final e in examples) {
      if (platform != null && e.domain != platform && e.domain != '通用') {
        continue;
      }
      final sim = _cosine(q, _ngramFreq(e.text));
      if (sim <= 0) continue;
      final heatBoost = 1 + (e.heat / 1000).clamp(0, 0.2);
      scored[e] = sim * heatBoost;
    }
    final sorted = scored.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final top = sorted.take(k).map((e) => e.key).toList();
    if (top.length < k) {
      // 兜底：按热度补足，保证有范例可参考
      top.addAll(examples.where((e) => !top.contains(e)).take(k - top.length));
    }
    return top;
  }

  /// 解析并合并外部语料 JSON，返回新增条数。解析失败抛 [FormatException]。
  int importJson(String raw) {
    final decoded = jsonDecode(raw);
    final list = decoded is List
        ? decoded
        : (decoded is Map && decoded['data'] is List
            ? decoded['data'] as List
            : null);
    if (list == null) {
      throw const FormatException('语料应为 JSON 数组，或含 data 数组的对象');
    }
    int added = 0;
    for (final item in list) {
      if (item is! Map) continue;
      final m = item;
      final text = _pick(m, ['content', 'text', 'comment', 'body', '正文']);
      if (text == null || text.isEmpty) continue;
      final tags = _pickList(m, ['tag', 'tags', 'category', 'category_name', '标签']);
      final domain = _pick(m, ['source', 'platform', 'domain', '平台']) ?? '通用';
      final heat =
          _toNum(_pick(m, ['likes', 'like_count', 'favorite_count', 'hot', '点赞']));
      examples.add(CorpusExample(text, tags, domain, heat));
      added++;
    }
    if (added == 0) {
      throw const FormatException('未从 JSON 中解析到有效评论（需含 content 等文本字段）');
    }
    return added;
  }

  static String? _pick(Map m, List<String> keys) {
    for (final k in keys) {
      final v = m[k];
      if (v != null && v.toString().trim().isNotEmpty) {
        return v.toString().trim();
      }
    }
    return null;
  }

  static List<String> _pickList(Map m, List<String> keys) {
    for (final k in keys) {
      final v = m[k];
      if (v is List) return v.map((e) => e.toString()).toList();
      if (v is String && v.isNotEmpty) {
        return v.split(RegExp(r'[/,，、]'));
      }
    }
    return const [];
  }

  static int _toNum(dynamic v) {
    if (v is num) return v.toInt();
    if (v is String) return int.tryParse(v.replaceAll(RegExp(r'\D'), '')) ?? 0;
    return 0;
  }

  /// 匿名化合成种子语料（多品类、多平台，用于默认 few-shot 范例）。
  static const List<CorpusExample> _seed = [
    CorpusExample('这玩意儿我用了快一个月，真的绝了，早上赶时间抹脸就走✨',
        ['护肤', '种草'], '小红书', 420),
    CorpusExample('谁懂啊，本来只是随便买买，结果直接回购第三瓶了🥹',
        ['回购', '种草'], '小红书', 380),
    CorpusExample('说真的听劝，油皮别盲入，先去专柜试一下再说',
        ['油皮', '避坑'], '小红书', 260),
    CorpusExample('这条裙子我穿去约会了，男朋友说显白到离谱哈哈',
        ['穿搭', '种草'], '小红书', 310),
    CorpusExample('姐妹们冲之前先量尺寸，我这个码数偏小一截😭',
        ['穿搭', '避坑'], '小红书', 240),
    CorpusExample('咖啡机到手两周，每天自己做省了好多钱，真香',
        ['好物', '种草'], '小红书', 290),
    CorpusExample('属实有点东西，这波价格打到我心里了🔥',
        ['价格', '抖音'], '抖音', 510),
    CorpusExample('就完了，本来想观望，结果直播间一上头直接下单💀',
        ['直播', '抖音'], '抖音', 470),
    CorpusExample('整挺好，就是物流慢了点，其它没毛病👍',
        ['物流', '抖音'], '抖音', 330),
    CorpusExample('啊这，吹得那么神，到手感觉也就那样呗',
        ['吐槽', '抖音'], '抖音', 360),
    CorpusExample('我直接好家伙，这操作看得我头皮发麻',
        ['吐槽', '抖音'], '抖音', 280),
    CorpusExample('家人们谁懂啊，半夜刷到直接笑醒',
        ['情绪', '抖音'], '抖音', 340),
    CorpusExample('我室友用了说很一般，但我自己觉得还行吧，看人',
        ['评价', '真实'], '通用', 200),
    CorpusExample('性价比确实可以，同价位里算能打的',
        ['性价比', '真实'], '通用', 230),
    CorpusExample('东西不错，客服也耐心，下次还来',
        ['服务', '种草'], '通用', 180),
    CorpusExample('收到比图片好看，没色差，开心',
        ['开箱', '种草'], '通用', 210),
    CorpusExample('一般般，没网上说的那么神，理性种草',
        ['理性', '避坑'], '通用', 190),
    CorpusExample('用了一阵子才来评，确实比之前那款顺手',
        ['真实', '评价'], '通用', 250),
  ];
}
