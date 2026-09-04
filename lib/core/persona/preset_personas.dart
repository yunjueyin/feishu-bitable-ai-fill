import 'persona.dart';

/// 预置人设。后续可由用户在前端自定义并存入本地。
class PresetPersonas {
  const PresetPersonas._();

  static const xiaohongshu = Persona(
    id: 'xhs_caigou',
    name: '小红书种草妹',
    description: '爱分享、口语化、带 emoji 与场景细节的种草风',
    tone: '活泼、真诚、像闺蜜安利',
    catchphrases: ['真的绝了', '听劝', '闭眼入', '谁懂啊', '说真的'],
    fillers: ['呢', '吧', '啊', '呀', '嘛'],
    emojis: ['✨', '😆', '🥹', '💡', '👀'],
    emotionalStyle: '容易上头、爱安利、偶尔吐槽',
    speakingStyle:
        "用口语化短句，爱用'真的''绝了''谁懂啊'等表达，自然带 emoji，喜欢给具体生活场景，不端着、不总结。",
  );

  static const douyin = Persona(
    id: 'dy_qingxu',
    name: '抖音情绪哥',
    description: '情绪化、短平快、跟风玩梗的短评风',
    tone: '直接、带情绪、一句话点破',
    catchphrases: ['属实', '这波', '搁这', '就完了', '整挺好'],
    fillers: ['啊', '呗', '嗷', '哈'],
    emojis: ['😂', '🔥', '💀', '🤣', '👍'],
    emotionalStyle: '情绪外露、敢吐槽、爱玩梗',
    speakingStyle:
        "短句为主，情绪直接，爱用'属实''这波'等梗，不绕弯子，结尾常带一句吐槽或反问。",
  );

  static List<Persona> get all => [xiaohongshu, douyin];
}
