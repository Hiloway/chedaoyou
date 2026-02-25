
export enum LaneType {
  CAR = 'Car',
  BUS = 'Bus',
  BIKE = 'Bike',
  HOV = 'HOV',
  EMERGENCY = 'Emergency'
}


export interface LaneInfo {
  id: string;
  roadName: string;
  laneCount: number;
  direction: 'north' | 'south' | 'east' | 'west' | 'bidirectional';
  type: LaneType;
  width: number; // meters
  condition: 'Excellent' | 'Good' | 'Fair' | 'Poor';
  lastUpdated: string;
  coordinates: { lat: number; lng: number }[];
}

export interface Region {
  name: string;
  lat: number;
  lng: number;
  zoom: number;
}

export interface MapState {
  center: { lat: number; lng: number };
  zoom: number;
  selectedLaneId: string | null;
}

export interface AnalysisResult {
  summary: string;
  safetyRating: number;
  recommendations: string[];
}
