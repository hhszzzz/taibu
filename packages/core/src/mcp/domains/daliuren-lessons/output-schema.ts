import { arr, obj, type OutputSchema, str } from '../../schema-builders.js';

const positionSchema = obj({
  课别: str('课别（一课 (干上)、二课 (干阴)、三课 (支上)、四课 (支阴)）'),
  传序: str('传序（初传 (发端)、中传 (移易)、末传 (归计)）'),
  地盘: str('所在宫位的地盘地支'),
  部位: str('盘面部位（天盘或天将）'),
});

const lessonRowSchema = obj({
  课别: str('课别'),
  上神: str('上神地支'),
  下神: str('下神（天盘压住的地盘或日干）'),
  上下: str('下贼上、上克下、比和、上生下、下生上'),
  天将: str('所乘天将'),
  神将: str('神克将（内战）、将克神（外战）、比和、神生将、将生神'),
  遁干: str('遁干（无则为“-”）'),
  六亲: str('上神相对日干的六亲'),
  位置: arr(positionSchema, '涉及的课别与宫位'),
});

const transmissionRowSchema = obj({
  传序: str('传序'),
  地支: str('传的地支'),
  五行: str('地支五行'),
  天将: str('所乘天将'),
  神将: str('神克将（内战）、将克神（外战）、比和、神生将、将生神'),
  遁干: str('遁干（无则为“-”）'),
  六亲: str('相对日干的六亲'),
  与日干: str('比和、生日干、克日干、日干生、日干克'),
  旺衰: str('旺衰（旺/相/休/囚/死）'),
  空亡: str('旬空或否'),
  位置: arr(positionSchema, '涉及的传序与宫位'),
});

const factRowSchema = obj({
  类型: str('事实类型（本命上神、行年上神、天盘落处、入课、入传）'),
  位置: arr(positionSchema, '涉及的位置'),
  结果: str('结果'),
  说明: str('事实说明'),
});

export const daliurenLessonsOutputSchema: OutputSchema = obj({
  查询: obj({ 范围: str('全部、课、传或类神'), 类神: str('本次定位的类神') }, '本次详查的范围'),
  基础: obj({
    日干: str('日干'), 日干寄宫: str('日干寄宫的地盘支'), 日支: str('日支'), 月建: str('月建地支'),
    旬: str('日干支所在旬'), 空亡: arr(str(), '日旬空'), 课式: str('课名与取传课体'),
  }, '起课基础'),
  四课: arr(lessonRowSchema, '四课的上下神、天将与神将生克'),
  三传: arr(transmissionRowSchema, '三传的地支、天将、六亲、旺衰与空亡'),
  三传递进: obj({ 初传至中传: str(), 中传至末传: str(), 递进: str('递生、递克或无') }, '三传之间的五行递进'),
  神将交战: arr(str(), '所列课传中神克将（内战）与将克神（外战）者；只看类神时省略'),
  本命行年: arr(factRowSchema, '本命与行年的上神'),
  类神: arr(factRowSchema, '类神的天盘落处与入课入传'),
  口径: arr(str(), '判定口径说明'),
});
