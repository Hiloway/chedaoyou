
import { LaneInfo, LaneType, Region } from './types';


export const CHINA_REGIONS = [
  {
    name: '北京市',
    children: [
      {
        name: '北京市',
        children: [
          { name: '东城区', lat: 39.9288, lng: 116.416, zoom: 15 },
          { name: '西城区', lat: 39.9123, lng: 116.3661, zoom: 15 },
          { name: '朝阳区', lat: 39.9219, lng: 116.4436, zoom: 15 },
          { name: '海淀区', lat: 39.9561, lng: 116.3103, zoom: 15 }
        ]
      }
    ]
  },
  {
    name: '上海市',
    children: [
      {
        name: '上海市',
        children: [
          { name: '黄浦区', lat: 31.2304, lng: 121.4737, zoom: 15 },
          { name: '徐汇区', lat: 31.1885, lng: 121.4365, zoom: 15 },
          { name: '浦东新区', lat: 31.2304, lng: 121.5447, zoom: 15 }
        ]
      }
    ]
  },
  {
    name: '重庆市',
    children: [
      {
        name: '重庆市',
        children: [
          { name: '江北区', lat: 29.574, lng: 106.5526, zoom: 15 },
          { name: '渝中区', lat: 29.5563, lng: 106.5715, zoom: 15 }
        ]
      }
    ]
  },
  {
    name: '湖南省',
    children: [
      {
        name: '长沙市',
        children: [
          { name: '天心区', lat: 28.1142, lng: 112.9797, zoom: 15 },
          { name: '岳麓区', lat: 28.2135, lng: 112.945, zoom: 15 }
        ]
      },
      {
        name: '株洲市',
        children: [
          { name: '荷塘区', lat: 27.8333, lng: 113.1333, zoom: 15 },
          { name: '天元区', lat: 27.8333, lng: 113.1333, zoom: 15 }
        ]
      }
    ]
  },
  {
    name: '广东省',
    children: [
      {
        name: '广州市',
        children: [
          { name: '天河区', lat: 23.1356, lng: 113.3612, zoom: 15 },
          { name: '越秀区', lat: 23.1252, lng: 113.2673, zoom: 15 }
        ]
      },
      {
        name: '深圳市',
        children: [
          { name: '福田区', lat: 22.541, lng: 114.0505, zoom: 15 },
          { name: '南山区', lat: 22.5312, lng: 113.9304, zoom: 15 }
        ]
      }
    ]
  },
  {
    name: '四川省',
    children: [
      {
        name: '成都市',
        children: [
          { name: '锦江区', lat: 30.6574, lng: 104.0809, zoom: 15 },
          { name: '青羊区', lat: 30.6749, lng: 104.0557, zoom: 15 }
        ]
      }
    ]
  },
  {
    name: '江苏省',
    children: [
      {
        name: '南京市',
        children: [
          { name: '玄武区', lat: 32.0603, lng: 118.7969, zoom: 15 },
          { name: '鼓楼区', lat: 32.0662, lng: 118.7969, zoom: 15 }
        ]
      },
      {
        name: '徐州市',
        children: [
          { name: '泉山区', lat: 34.2044, lng: 117.2841, zoom: 15 },
          { name: '鼓楼区', lat: 34.2044, lng: 117.2841, zoom: 15 }
        ]
      }
    ]
  },
  {
    name: '浙江省',
    children: [
      {
        name: '杭州市',
        children: [
          { name: '西湖区', lat: 30.2741, lng: 120.1551, zoom: 15 },
          { name: '上城区', lat: 30.2425, lng: 120.1693, zoom: 15 }
        ]
      }
    ]
  },
  {
    name: '陕西省',
    children: [
      {
        name: '西安市',
        children: [
          { name: '碑林区', lat: 34.251, lng: 108.9469, zoom: 15 },
          { name: '雁塔区', lat: 34.2232, lng: 108.9265, zoom: 15 }
        ]
      }
    ]
  },
  {
    name: '湖北省',
    children: [
      {
        name: '武汉市',
        children: [
          { name: '江岸区', lat: 30.6015, lng: 114.3091, zoom: 15 },
          { name: '武昌区', lat: 30.5539, lng: 114.3162, zoom: 15 }
        ]
      }
    ]
  }
];

export const MAP_DEFAULT_PROPS = {
  center: { lat: 39.9288, lng:  116.416 }, // 默认北京
  zoom: 15
};
