/// 人设（Persona）模型：有人味的根本——稳定的语气、口头禅、用词习惯。
class Persona {
  final String id;
  final String name;
  final String description;
  final String tone; // 整体语气描述，例如"活泼种草风"
  final List<String> catchphrases; // 口头禅，可选插入
  final List<String> fillers; // 语气词，例如 ["呢", "吧", "啊", "呀"]
  final List<String> emojis; // 常用 emoji
  final String emotionalStyle; // 情感风格，例如"容易上头、爱吐槽"
  final String speakingStyle; // 喂给 prompt 的语言风格说明

  const Persona({
    required this.id,
    required this.name,
    required this.description,
    required this.tone,
    this.catchphrases = const [],
    this.fillers = const [],
    this.emojis = const [],
    this.emotionalStyle = '',
    this.speakingStyle = '',
  });

  factory Persona.fromJson(Map<String, dynamic> j) => Persona(
        id: j['id'] as String,
        name: j['name'] as String,
        description: j['description'] as String? ?? '',
        tone: j['tone'] as String? ?? '',
        catchphrases: List<String>.from(j['catchphrases'] ?? const []),
        fillers: List<String>.from(j['fillers'] ?? const []),
        emojis: List<String>.from(j['emojis'] ?? const []),
        emotionalStyle: j['emotionalStyle'] as String? ?? '',
        speakingStyle: j['speakingStyle'] as String? ?? '',
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'description': description,
        'tone': tone,
        'catchphrases': catchphrases,
        'fillers': fillers,
        'emojis': emojis,
        'emotionalStyle': emotionalStyle,
        'speakingStyle': speakingStyle,
      };
}
