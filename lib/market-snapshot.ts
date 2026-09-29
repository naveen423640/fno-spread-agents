export type MarketStock = {
  symbol: string;
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  previousClose: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type SectorIndex = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  previousClose: number;
};

export const snapshotAsOf = "2026-08-31T05:41:46.285Z";

export const marketSnapshot: MarketStock[] = [
  {
    "symbol": "NSE:360ONE-EQ",
    "ticker": "360ONE",
    "name": "360 ONE WAM LIMITED",
    "price": 1160.4,
    "change": -39.6,
    "changePct": -3.3,
    "previousClose": 1200
  },
  {
    "symbol": "NSE:ABB-EQ",
    "ticker": "ABB",
    "name": "ABB INDIA LIMITED",
    "price": 7336.5,
    "change": -172.5,
    "changePct": -2.2972433080303634,
    "previousClose": 7509
  },
  {
    "symbol": "NSE:ABCAPITAL-EQ",
    "ticker": "ABCAPITAL",
    "name": "ADITYA BIRLA CAPITAL LTD.",
    "price": 398.85,
    "change": -6.7,
    "changePct": -1.6520774257181605,
    "previousClose": 405.55
  },
  {
    "symbol": "NSE:ADANIENSOL-EQ",
    "ticker": "ADANIENSOL",
    "name": "ADANI ENERGY SOLUTION LTD",
    "price": 1558.5,
    "change": -22.9,
    "changePct": -1.4480839762235993,
    "previousClose": 1581.4
  },
  {
    "symbol": "NSE:ADANIENT-EQ",
    "ticker": "ADANIENT",
    "name": "ADANI ENTERPRISES LIMITED",
    "price": 3072.6,
    "change": -95.9,
    "changePct": -3.026668770711693,
    "previousClose": 3168.5
  },
  {
    "symbol": "NSE:ADANIGREEN-EQ",
    "ticker": "ADANIGREEN",
    "name": "ADANI GREEN ENERGY LTD",
    "price": 1291.5,
    "change": -19.5,
    "changePct": -1.4874141876430207,
    "previousClose": 1311
  },
  {
    "symbol": "NSE:ADANIPORTS-EQ",
    "ticker": "ADANIPORTS",
    "name": "ADANI PORT & SEZ LTD",
    "price": 1678.8,
    "change": -28.7,
    "changePct": -1.6808199121522693,
    "previousClose": 1707.5
  },
  {
    "symbol": "NSE:ADANIPOWER-EQ",
    "ticker": "ADANIPOWER",
    "name": "ADANI POWER LTD",
    "price": 208.7,
    "change": -3.93,
    "changePct": -1.8482810515919672,
    "previousClose": 212.63
  },
  {
    "symbol": "NSE:ALKEM-EQ",
    "ticker": "ALKEM",
    "name": "ALKEM LABORATORIES LTD.",
    "price": 5326.5,
    "change": -28.5,
    "changePct": -0.5322128851540616,
    "previousClose": 5355
  },
  {
    "symbol": "NSE:AMBER-EQ",
    "ticker": "AMBER",
    "name": "AMBER ENTERPRISES (I) LTD",
    "price": 7615.5,
    "change": -59.5,
    "changePct": -0.7752442996742671,
    "previousClose": 7675
  },
  {
    "symbol": "NSE:AMBUJACEM-EQ",
    "ticker": "AMBUJACEM",
    "name": "AMBUJA CEMENTS LTD",
    "price": 406.2,
    "change": -5.85,
    "changePct": -1.4197306152165998,
    "previousClose": 412.05
  },
  {
    "symbol": "NSE:ANGELONE-EQ",
    "ticker": "ANGELONE",
    "name": "ANGEL ONE LIMITED",
    "price": 284.4,
    "change": -9.6,
    "changePct": -3.2653061224489797,
    "previousClose": 294
  },
  {
    "symbol": "NSE:APLAPOLLO-EQ",
    "ticker": "APLAPOLLO",
    "name": "APL APOLLO TUBES LTD",
    "price": 2233.2,
    "change": -32.4,
    "changePct": -1.430084745762712,
    "previousClose": 2265.6
  },
  {
    "symbol": "NSE:APOLLOHOSP-EQ",
    "ticker": "APOLLOHOSP",
    "name": "APOLLO HOSPITALS ENTER. L",
    "price": 8855.5,
    "change": 17,
    "changePct": 0.1923403292413871,
    "previousClose": 8838.5
  },
  {
    "symbol": "NSE:ASHOKLEY-EQ",
    "ticker": "ASHOKLEY",
    "name": "ASHOK LEYLAND LTD",
    "price": 174.9,
    "change": -0.87,
    "changePct": -0.49496501109404334,
    "previousClose": 175.77
  },
  {
    "symbol": "NSE:ASIANPAINT-EQ",
    "ticker": "ASIANPAINT",
    "name": "ASIAN PAINTS LIMITED",
    "price": 2569,
    "change": -39.7,
    "changePct": -1.5218307969486717,
    "previousClose": 2608.7
  },
  {
    "symbol": "NSE:ASTRAL-EQ",
    "ticker": "ASTRAL",
    "name": "ASTRAL LIMITED",
    "price": 1541.3,
    "change": 9,
    "changePct": 0.587352346146316,
    "previousClose": 1532.3
  },
  {
    "symbol": "NSE:ATHERENERG-EQ",
    "ticker": "ATHERENERG",
    "name": "ATHER ENERGY LIMITED",
    "price": 1676.5,
    "change": 60.2,
    "changePct": 3.7245560848852315,
    "previousClose": 1616.3
  },
  {
    "symbol": "NSE:AUBANK-EQ",
    "ticker": "AUBANK",
    "name": "AU SMALL FINANCE BANK LTD",
    "price": 1067.6,
    "change": -9.5,
    "changePct": -0.8819979574784143,
    "previousClose": 1077.1
  },
  {
    "symbol": "NSE:AUROPHARMA-EQ",
    "ticker": "AUROPHARMA",
    "name": "AUROBINDO PHARMA LTD",
    "price": 1668.2,
    "change": 22.9,
    "changePct": 1.3918434328086062,
    "previousClose": 1645.3
  },
  {
    "symbol": "NSE:AXISBANK-EQ",
    "ticker": "AXISBANK",
    "name": "AXIS BANK LIMITED",
    "price": 1259.4,
    "change": -5.6,
    "changePct": -0.4426877470355731,
    "previousClose": 1265
  },
  {
    "symbol": "NSE:BAJAJ-AUTO-EQ",
    "ticker": "BAJAJ-AUTO",
    "name": "BAJAJ AUTO LIMITED",
    "price": 11952,
    "change": 42,
    "changePct": 0.3526448362720403,
    "previousClose": 11910
  },
  {
    "symbol": "NSE:BAJAJFINSV-EQ",
    "ticker": "BAJAJFINSV",
    "name": "BAJAJ FINSERV LTD.",
    "price": 1968.9,
    "change": -33.1,
    "changePct": -1.6533466533466534,
    "previousClose": 2002
  },
  {
    "symbol": "NSE:BAJAJHLDNG-EQ",
    "ticker": "BAJAJHLDNG",
    "name": "BAJAJ HOLDINGS & INVS LTD",
    "price": 11335,
    "change": -5,
    "changePct": -0.04409171075837742,
    "previousClose": 11340
  },
  {
    "symbol": "NSE:BAJFINANCE-EQ",
    "ticker": "BAJFINANCE",
    "name": "BAJAJ FINANCE LIMITED",
    "price": 1052.3,
    "change": -27.6,
    "changePct": -2.5557922029817575,
    "previousClose": 1079.9
  },
  {
    "symbol": "NSE:BANDHANBNK-EQ",
    "ticker": "BANDHANBNK",
    "name": "BANDHAN BANK LIMITED",
    "price": 164.44,
    "change": -3.81,
    "changePct": -2.264487369985141,
    "previousClose": 168.25
  },
  {
    "symbol": "NSE:BANKBARODA-EQ",
    "ticker": "BANKBARODA",
    "name": "BANK OF BARODA",
    "price": 236.53,
    "change": -5.37,
    "changePct": -2.219925589086399,
    "previousClose": 241.9
  },
  {
    "symbol": "NSE:BANKINDIA-EQ",
    "ticker": "BANKINDIA",
    "name": "BANK OF INDIA",
    "price": 140.9,
    "change": -3.1,
    "changePct": -2.1527777777777777,
    "previousClose": 144
  },
  {
    "symbol": "NSE:BDL-EQ",
    "ticker": "BDL",
    "name": "BHARAT DYNAMICS LIMITED",
    "price": 1267.6,
    "change": -38.4,
    "changePct": -2.9402756508422665,
    "previousClose": 1306
  },
  {
    "symbol": "NSE:BEL-EQ",
    "ticker": "BEL",
    "name": "BHARAT ELECTRONICS LTD",
    "price": 407.4,
    "change": -4.5,
    "changePct": -1.0924981791697015,
    "previousClose": 411.9
  },
  {
    "symbol": "NSE:BHARATFORG-EQ",
    "ticker": "BHARATFORG",
    "name": "BHARAT FORGE LTD",
    "price": 2016.2,
    "change": -21.5,
    "changePct": -1.0551111547332777,
    "previousClose": 2037.7
  },
  {
    "symbol": "NSE:BHARTIARTL-EQ",
    "ticker": "BHARTIARTL",
    "name": "BHARTI AIRTEL LIMITED",
    "price": 1891.1,
    "change": 8.7,
    "changePct": 0.46217594560135994,
    "previousClose": 1882.4
  },
  {
    "symbol": "NSE:BHEL-EQ",
    "ticker": "BHEL",
    "name": "BHEL",
    "price": 424.7,
    "change": -6.15,
    "changePct": -1.4274109318788442,
    "previousClose": 430.85
  },
  {
    "symbol": "NSE:BIOCON-EQ",
    "ticker": "BIOCON",
    "name": "BIOCON LIMITED.",
    "price": 407.5,
    "change": -3.6,
    "changePct": -0.8756993432254926,
    "previousClose": 411.1
  },
  {
    "symbol": "NSE:BLUESTARCO-EQ",
    "ticker": "BLUESTARCO",
    "name": "BLUE STAR LIMITED",
    "price": 1465,
    "change": -15,
    "changePct": -1.0135135135135136,
    "previousClose": 1480
  },
  {
    "symbol": "NSE:BOSCHLTD-EQ",
    "ticker": "BOSCHLTD",
    "name": "BOSCH LIMITED",
    "price": 48735,
    "change": 95,
    "changePct": 0.1953125,
    "previousClose": 48640
  },
  {
    "symbol": "NSE:BPCL-EQ",
    "ticker": "BPCL",
    "name": "BHARAT PETROLEUM CORP  LT",
    "price": 311.5,
    "change": -7.75,
    "changePct": -2.427564604541895,
    "previousClose": 319.25
  },
  {
    "symbol": "NSE:BRITANNIA-EQ",
    "ticker": "BRITANNIA",
    "name": "BRITANNIA INDUSTRIES LTD",
    "price": 5252.5,
    "change": -56,
    "changePct": -1.0549119336912498,
    "previousClose": 5308.5
  },
  {
    "symbol": "NSE:BSE-EQ",
    "ticker": "BSE",
    "name": "BSE LIMITED",
    "price": 3316.5,
    "change": -88.5,
    "changePct": -2.5991189427312777,
    "previousClose": 3405
  },
  {
    "symbol": "NSE:CAMS-EQ",
    "ticker": "CAMS",
    "name": "COMPUTER AGE MNGT SER LTD",
    "price": 767.2,
    "change": 5.2,
    "changePct": 0.6824146981627297,
    "previousClose": 762
  },
  {
    "symbol": "NSE:CANBK-EQ",
    "ticker": "CANBK",
    "name": "CANARA BANK",
    "price": 125.76,
    "change": -2.59,
    "changePct": -2.0179197506817297,
    "previousClose": 128.35
  },
  {
    "symbol": "NSE:CDSL-EQ",
    "ticker": "CDSL",
    "name": "CENTRAL DEPO SER (I) LTD",
    "price": 1384,
    "change": -30.7,
    "changePct": -2.1700713932282465,
    "previousClose": 1414.7
  },
  {
    "symbol": "NSE:CGPOWER-EQ",
    "ticker": "CGPOWER",
    "name": "CG POWER AND IND SOL LTD",
    "price": 877.6,
    "change": -11.4,
    "changePct": -1.282339707536558,
    "previousClose": 889
  },
  {
    "symbol": "NSE:CHOLAFIN-EQ",
    "ticker": "CHOLAFIN",
    "name": "CHOLAMANDALAM IN & FIN CO",
    "price": 1810.4,
    "change": -52.5,
    "changePct": -2.818186698158785,
    "previousClose": 1862.9
  },
  {
    "symbol": "NSE:CIPLA-EQ",
    "ticker": "CIPLA",
    "name": "CIPLA LTD",
    "price": 1413.9,
    "change": -9.6,
    "changePct": -0.6743940990516333,
    "previousClose": 1423.5
  },
  {
    "symbol": "NSE:COALINDIA-EQ",
    "ticker": "COALINDIA",
    "name": "COAL INDIA LTD",
    "price": 402.45,
    "change": 1.45,
    "changePct": 0.36159600997506236,
    "previousClose": 401
  },
  {
    "symbol": "NSE:COCHINSHIP-EQ",
    "ticker": "COCHINSHIP",
    "name": "COCHIN SHIPYARD LIMITED",
    "price": 1505.4,
    "change": -29.6,
    "changePct": -1.9283387622149837,
    "previousClose": 1535
  },
  {
    "symbol": "NSE:COFORGE-EQ",
    "ticker": "COFORGE",
    "name": "COFORGE LIMITED",
    "price": 1980.1,
    "change": -34.5,
    "changePct": -1.7124987590588703,
    "previousClose": 2014.6
  },
  {
    "symbol": "NSE:COLPAL-EQ",
    "ticker": "COLPAL",
    "name": "COLGATE PALMOLIVE LTD.",
    "price": 1808.4,
    "change": -18.5,
    "changePct": -1.0126443702446768,
    "previousClose": 1826.9
  },
  {
    "symbol": "NSE:CONCOR-EQ",
    "ticker": "CONCOR",
    "name": "CONTAINER CORP OF IND LTD",
    "price": 507.95,
    "change": -8.05,
    "changePct": -1.560077519379845,
    "previousClose": 516
  },
  {
    "symbol": "NSE:CROMPTON-EQ",
    "ticker": "CROMPTON",
    "name": "CROMPT GREA CON ELEC LTD",
    "price": 227.7,
    "change": -5.3,
    "changePct": -2.274678111587983,
    "previousClose": 233
  },
  {
    "symbol": "NSE:CUMMINSIND-EQ",
    "ticker": "CUMMINSIND",
    "name": "CUMMINS INDIA LTD",
    "price": 5108,
    "change": -85,
    "changePct": -1.6368187945310995,
    "previousClose": 5193
  },
  {
    "symbol": "NSE:DABUR-EQ",
    "ticker": "DABUR",
    "name": "DABUR INDIA LTD",
    "price": 382.05,
    "change": -3.95,
    "changePct": -1.0233160621761659,
    "previousClose": 386
  },
  {
    "symbol": "NSE:DELHIVERY-EQ",
    "ticker": "DELHIVERY",
    "name": "DELHIVERY LIMITED",
    "price": 463.8,
    "change": -6.4,
    "changePct": -1.361122926414292,
    "previousClose": 470.2
  },
  {
    "symbol": "NSE:DIVISLAB-EQ",
    "ticker": "DIVISLAB",
    "name": "DIVI S LABORATORIES LTD",
    "price": 9189,
    "change": -50,
    "changePct": -0.5411841108345059,
    "previousClose": 9239
  },
  {
    "symbol": "NSE:DIXON-EQ",
    "ticker": "DIXON",
    "name": "DIXON TECHNO (INDIA) LTD",
    "price": 14679,
    "change": 29,
    "changePct": 0.19795221843003413,
    "previousClose": 14650
  },
  {
    "symbol": "NSE:DLF-EQ",
    "ticker": "DLF",
    "name": "DLF LIMITED",
    "price": 665.35,
    "change": -14.45,
    "changePct": -2.1256251838776112,
    "previousClose": 679.8
  },
  {
    "symbol": "NSE:DMART-EQ",
    "ticker": "DMART",
    "name": "AVENUE SUPERMARTS LIMITED",
    "price": 3782.4,
    "change": -48.2,
    "changePct": -1.2582885187699056,
    "previousClose": 3830.6
  },
  {
    "symbol": "NSE:DRREDDY-EQ",
    "ticker": "DRREDDY",
    "name": "DR. REDDY S LABORATORIES",
    "price": 1175.1,
    "change": -2.9,
    "changePct": -0.2461799660441426,
    "previousClose": 1178
  },
  {
    "symbol": "NSE:EICHERMOT-EQ",
    "ticker": "EICHERMOT",
    "name": "EICHER MOTORS LTD",
    "price": 7965,
    "change": -94,
    "changePct": -1.1663978161062167,
    "previousClose": 8059
  },
  {
    "symbol": "NSE:ETERNAL-EQ",
    "ticker": "ETERNAL",
    "name": "ETERNAL LIMITED",
    "price": 327.5,
    "change": -0.5,
    "changePct": -0.1524390243902439,
    "previousClose": 328
  },
  {
    "symbol": "NSE:FEDERALBNK-EQ",
    "ticker": "FEDERALBNK",
    "name": "FEDERAL BANK LTD",
    "price": 342.3,
    "change": -1.95,
    "changePct": -0.5664488017429193,
    "previousClose": 344.25
  },
  {
    "symbol": "NSE:FORCEMOT-EQ",
    "ticker": "FORCEMOT",
    "name": "FORCE MOTORS LIMITED",
    "price": 17163,
    "change": -207,
    "changePct": -1.1917098445595855,
    "previousClose": 17370
  },
  {
    "symbol": "NSE:FORTIS-EQ",
    "ticker": "FORTIS",
    "name": "FORTIS HEALTHCARE LTD",
    "price": 904.6,
    "change": -22.15,
    "changePct": -2.3900728351766927,
    "previousClose": 926.75
  },
  {
    "symbol": "NSE:GAIL-EQ",
    "ticker": "GAIL",
    "name": "GAIL (INDIA) LTD",
    "price": 171.5,
    "change": 0.4,
    "changePct": 0.23378141437755698,
    "previousClose": 171.1
  },
  {
    "symbol": "NSE:GLENMARK-EQ",
    "ticker": "GLENMARK",
    "name": "GLENMARK PHARMACEUTICALS",
    "price": 2470.3,
    "change": -44.7,
    "changePct": -1.7773359840954275,
    "previousClose": 2515
  },
  {
    "symbol": "NSE:GMRAIRPORT-EQ",
    "ticker": "GMRAIRPORT",
    "name": "GMR AIRPORTS LIMITED",
    "price": 96.21,
    "change": -2.1,
    "changePct": -2.1361000915471466,
    "previousClose": 98.31
  },
  {
    "symbol": "NSE:GODFRYPHLP-EQ",
    "ticker": "GODFRYPHLP",
    "name": "GODFREY PHILLIPS INDIA LT",
    "price": 2097,
    "change": -26.7,
    "changePct": -1.2572397231247352,
    "previousClose": 2123.7
  },
  {
    "symbol": "NSE:GODREJCP-EQ",
    "ticker": "GODREJCP",
    "name": "GODREJ CONSUMER PRODUCTS",
    "price": 902.7,
    "change": -12.3,
    "changePct": -1.3442622950819672,
    "previousClose": 915
  },
  {
    "symbol": "NSE:GODREJPROP-EQ",
    "ticker": "GODREJPROP",
    "name": "GODREJ PROPERTIES LTD",
    "price": 1966.6,
    "change": -62.5,
    "changePct": -3.080183332511951,
    "previousClose": 2029.1
  },
  {
    "symbol": "NSE:GRASIM-EQ",
    "ticker": "GRASIM",
    "name": "GRASIM INDUSTRIES LTD",
    "price": 3278.7,
    "change": -11.3,
    "changePct": -0.3434650455927052,
    "previousClose": 3290
  },
  {
    "symbol": "NSE:GVT&D-EQ",
    "ticker": "GVT&D",
    "name": "GE VERNOVA T&D INDIA LTD",
    "price": 4282.6,
    "change": -56.6,
    "changePct": -1.3043879056047198,
    "previousClose": 4339.2
  },
  {
    "symbol": "NSE:HAL-EQ",
    "ticker": "HAL",
    "name": "HINDUSTAN AERONAUTICS LTD",
    "price": 4778.4,
    "change": -82.7,
    "changePct": -1.7012610314537862,
    "previousClose": 4861.1
  },
  {
    "symbol": "NSE:HAVELLS-EQ",
    "ticker": "HAVELLS",
    "name": "HAVELLS INDIA LIMITED",
    "price": 1201.3,
    "change": -21.6,
    "changePct": -1.76629323738654,
    "previousClose": 1222.9
  },
  {
    "symbol": "NSE:HCLTECH-EQ",
    "ticker": "HCLTECH",
    "name": "HCL TECHNOLOGIES LTD",
    "price": 1302.5,
    "change": -13.6,
    "changePct": -1.0333561279538028,
    "previousClose": 1316.1
  },
  {
    "symbol": "NSE:HDFCAMC-EQ",
    "ticker": "HDFCAMC",
    "name": "HDFC AMC LIMITED",
    "price": 2541,
    "change": -28,
    "changePct": -1.0899182561307903,
    "previousClose": 2569
  },
  {
    "symbol": "NSE:HDFCBANK-EQ",
    "ticker": "HDFCBANK",
    "name": "HDFC BANK LTD",
    "price": 724.7,
    "change": 4.4,
    "changePct": 0.6108565875329723,
    "previousClose": 720.3
  },
  {
    "symbol": "NSE:HDFCLIFE-EQ",
    "ticker": "HDFCLIFE",
    "name": "HDFC LIFE INS CO LTD",
    "price": 541.1,
    "change": -6.9,
    "changePct": -1.2591240875912408,
    "previousClose": 548
  },
  {
    "symbol": "NSE:HEROMOTOCO-EQ",
    "ticker": "HEROMOTOCO",
    "name": "HERO MOTOCORP LIMITED",
    "price": 5554,
    "change": -46,
    "changePct": -0.8214285714285714,
    "previousClose": 5600
  },
  {
    "symbol": "NSE:HINDALCO-EQ",
    "ticker": "HINDALCO",
    "name": "HINDALCO  INDUSTRIES  LTD",
    "price": 1010.75,
    "change": -26.65,
    "changePct": -2.568922305764411,
    "previousClose": 1037.4
  },
  {
    "symbol": "NSE:HINDPETRO-EQ",
    "ticker": "HINDPETRO",
    "name": "HINDUSTAN PETROLEUM CORP",
    "price": 357.55,
    "change": -6.45,
    "changePct": -1.771978021978022,
    "previousClose": 364
  },
  {
    "symbol": "NSE:HINDUNILVR-EQ",
    "ticker": "HINDUNILVR",
    "name": "HINDUSTAN UNILEVER LTD.",
    "price": 1990.9,
    "change": -19.5,
    "changePct": -0.9699562276163948,
    "previousClose": 2010.4
  },
  {
    "symbol": "NSE:HINDZINC-EQ",
    "ticker": "HINDZINC",
    "name": "HINDUSTAN ZINC LIMITED",
    "price": 596.2,
    "change": -25.8,
    "changePct": -4.147909967845659,
    "previousClose": 622
  },
  {
    "symbol": "NSE:HYUNDAI-EQ",
    "ticker": "HYUNDAI",
    "name": "HYUNDAI MOTOR INDIA LTD",
    "price": 2258.8,
    "change": -8.2,
    "changePct": -0.36171151301279225,
    "previousClose": 2267
  },
  {
    "symbol": "NSE:ICICIBANK-EQ",
    "ticker": "ICICIBANK",
    "name": "ICICI BANK LTD.",
    "price": 1423,
    "change": 0.2,
    "changePct": 0.014056789429294348,
    "previousClose": 1422.8
  },
  {
    "symbol": "NSE:ICICIGI-EQ",
    "ticker": "ICICIGI",
    "name": "ICICI LOMBARD GIC LIMITED",
    "price": 1540.2,
    "change": -21.8,
    "changePct": -1.3956466069142126,
    "previousClose": 1562
  },
  {
    "symbol": "NSE:ICICIPRULI-EQ",
    "ticker": "ICICIPRULI",
    "name": "ICICI PRU LIFE INS CO LTD",
    "price": 505.05,
    "change": -0.95,
    "changePct": -0.18774703557312253,
    "previousClose": 506
  },
  {
    "symbol": "NSE:IDEA-EQ",
    "ticker": "IDEA",
    "name": "VODAFONE IDEA LIMITED",
    "price": 14.77,
    "change": 0.09,
    "changePct": 0.6130790190735694,
    "previousClose": 14.68
  },
  {
    "symbol": "NSE:IDFCFIRSTB-EQ",
    "ticker": "IDFCFIRSTB",
    "name": "IDFC FIRST BANK LIMITED",
    "price": 82.64,
    "change": -0.48,
    "changePct": -0.5774783445620789,
    "previousClose": 83.12
  },
  {
    "symbol": "NSE:IEX-EQ",
    "ticker": "IEX",
    "name": "INDIAN ENERGY EXC LTD",
    "price": 119.79,
    "change": -2.01,
    "changePct": -1.6502463054187193,
    "previousClose": 121.8
  },
  {
    "symbol": "NSE:INDHOTEL-EQ",
    "ticker": "INDHOTEL",
    "name": "THE INDIAN HOTELS CO. LTD",
    "price": 706.25,
    "change": -0.15,
    "changePct": -0.021234428086070217,
    "previousClose": 706.4
  },
  {
    "symbol": "NSE:INDIANB-EQ",
    "ticker": "INDIANB",
    "name": "INDIAN BANK",
    "price": 865.15,
    "change": -17.25,
    "changePct": -1.9548957388939256,
    "previousClose": 882.4
  },
  {
    "symbol": "NSE:INDIGO-EQ",
    "ticker": "INDIGO",
    "name": "INTERGLOBE AVIATION LTD",
    "price": 5075,
    "change": -91,
    "changePct": -1.7615176151761518,
    "previousClose": 5166
  },
  {
    "symbol": "NSE:INDUSINDBK-EQ",
    "ticker": "INDUSINDBK",
    "name": "INDUSIND BANK LIMITED",
    "price": 985.2,
    "change": -8.8,
    "changePct": -0.8853118712273642,
    "previousClose": 994
  },
  {
    "symbol": "NSE:INDUSTOWER-EQ",
    "ticker": "INDUSTOWER",
    "name": "INDUS TOWERS LIMITED",
    "price": 381.5,
    "change": 1.5,
    "changePct": 0.39473684210526316,
    "previousClose": 380
  },
  {
    "symbol": "NSE:INFY-EQ",
    "ticker": "INFY",
    "name": "INFOSYS LIMITED",
    "price": 1117.5,
    "change": -26.5,
    "changePct": -2.3164335664335662,
    "previousClose": 1144
  },
  {
    "symbol": "NSE:INOXWIND-EQ",
    "ticker": "INOXWIND",
    "name": "INOX WIND LIMITED",
    "price": 69.94,
    "change": -1.85,
    "changePct": -2.5769605794678925,
    "previousClose": 71.79
  },
  {
    "symbol": "NSE:IOC-EQ",
    "ticker": "IOC",
    "name": "INDIAN OIL CORP LTD",
    "price": 134.86,
    "change": -2.24,
    "changePct": -1.6338439095550692,
    "previousClose": 137.1
  },
  {
    "symbol": "NSE:IREDA-EQ",
    "ticker": "IREDA",
    "name": "INDIAN RENEWABLE ENERGY",
    "price": 114.85,
    "change": -2.17,
    "changePct": -1.854383866005811,
    "previousClose": 117.02
  },
  {
    "symbol": "NSE:IRFC-EQ",
    "ticker": "IRFC",
    "name": "INDIAN RAILWAY FIN CORP L",
    "price": 83.13,
    "change": -0.77,
    "changePct": -0.9177592371871275,
    "previousClose": 83.9
  },
  {
    "symbol": "NSE:ITC-EQ",
    "ticker": "ITC",
    "name": "ITC LTD",
    "price": 264.7,
    "change": -1.3,
    "changePct": -0.48872180451127817,
    "previousClose": 266
  },
  {
    "symbol": "NSE:JINDALSTEL-EQ",
    "ticker": "JINDALSTEL",
    "name": "JINDAL STEEL LIMITED",
    "price": 1159.6,
    "change": -19.6,
    "changePct": -1.662143826322931,
    "previousClose": 1179.2
  },
  {
    "symbol": "NSE:JIOFIN-EQ",
    "ticker": "JIOFIN",
    "name": "JIO FIN SERVICES LTD",
    "price": 236.45,
    "change": -1.95,
    "changePct": -0.8179530201342282,
    "previousClose": 238.4
  },
  {
    "symbol": "NSE:JSWENERGY-EQ",
    "ticker": "JSWENERGY",
    "name": "JSW ENERGY LIMITED",
    "price": 524.3,
    "change": -11,
    "changePct": -2.0549224733794134,
    "previousClose": 535.3
  },
  {
    "symbol": "NSE:JSWSTEEL-EQ",
    "ticker": "JSWSTEEL",
    "name": "JSW STEEL LIMITED",
    "price": 1311.8,
    "change": -23.1,
    "changePct": -1.73046670162559,
    "previousClose": 1334.9
  },
  {
    "symbol": "NSE:JUBLFOOD-EQ",
    "ticker": "JUBLFOOD",
    "name": "JUBILANT FOODWORKS LTD",
    "price": 481.2,
    "change": -9.25,
    "changePct": -1.8860230400652462,
    "previousClose": 490.45
  },
  {
    "symbol": "NSE:KALYANKJIL-EQ",
    "ticker": "KALYANKJIL",
    "name": "KALYAN JEWELLERS IND LTD",
    "price": 611.6,
    "change": -4.2,
    "changePct": -0.6820396232543033,
    "previousClose": 615.8
  },
  {
    "symbol": "NSE:KAYNES-EQ",
    "ticker": "KAYNES",
    "name": "KAYNES TECHNOLOGY IND LTD",
    "price": 3741.5,
    "change": -201.6,
    "changePct": -5.112728563820345,
    "previousClose": 3943.1
  },
  {
    "symbol": "NSE:KEI-EQ",
    "ticker": "KEI",
    "name": "KEI INDUSTRIES LTD.",
    "price": 5451,
    "change": -119,
    "changePct": -2.1364452423698386,
    "previousClose": 5570
  },
  {
    "symbol": "NSE:KFINTECH-EQ",
    "ticker": "KFINTECH",
    "name": "KFIN TECHNOLOGIES LIMITED",
    "price": 933.35,
    "change": -16.6,
    "changePct": -1.747460392652245,
    "previousClose": 949.95
  },
  {
    "symbol": "NSE:KOTAKBANK-EQ",
    "ticker": "KOTAKBANK",
    "name": "KOTAK MAHINDRA BANK LTD",
    "price": 423.45,
    "change": -0.25,
    "changePct": -0.059004012272834555,
    "previousClose": 423.7
  },
  {
    "symbol": "NSE:KPITTECH-EQ",
    "ticker": "KPITTECH",
    "name": "KPIT TECHNOLOGIES LIMITED",
    "price": 589,
    "change": -20.4,
    "changePct": -3.347554972103709,
    "previousClose": 609.4
  },
  {
    "symbol": "NSE:LAURUSLABS-EQ",
    "ticker": "LAURUSLABS",
    "name": "LAURUS LABS LIMITED",
    "price": 1915.3,
    "change": -23.2,
    "changePct": -1.1968016507608976,
    "previousClose": 1938.5
  },
  {
    "symbol": "NSE:LICHSGFIN-EQ",
    "ticker": "LICHSGFIN",
    "name": "LIC HOUSING FINANCE LTD",
    "price": 535.45,
    "change": 0.45,
    "changePct": 0.08411214953271028,
    "previousClose": 535
  },
  {
    "symbol": "NSE:LICI-EQ",
    "ticker": "LICI",
    "name": "LIFE INSURA CORP OF INDIA",
    "price": 412.95,
    "change": -9.05,
    "changePct": -2.1445497630331753,
    "previousClose": 422
  },
  {
    "symbol": "NSE:LODHA-EQ",
    "ticker": "LODHA",
    "name": "LODHA DEVELOPERS LIMITED",
    "price": 1225.6,
    "change": -48.4,
    "changePct": -3.7990580847723705,
    "previousClose": 1274
  },
  {
    "symbol": "NSE:LT-EQ",
    "ticker": "LT",
    "name": "LARSEN & TOUBRO LTD.",
    "price": 3982,
    "change": -63.8,
    "changePct": -1.5769439912996193,
    "previousClose": 4045.8
  },
  {
    "symbol": "NSE:LTF-EQ",
    "ticker": "LTF",
    "name": "L&T FINANCE LIMITED",
    "price": 308.1,
    "change": -6.2,
    "changePct": -1.9726376073814826,
    "previousClose": 314.3
  },
  {
    "symbol": "NSE:LTM-EQ",
    "ticker": "LTM",
    "name": "LTM LIMITED",
    "price": 4545,
    "change": -130,
    "changePct": -2.7807486631016043,
    "previousClose": 4675
  },
  {
    "symbol": "NSE:LUPIN-EQ",
    "ticker": "LUPIN",
    "name": "LUPIN LIMITED",
    "price": 2154.4,
    "change": -17.1,
    "changePct": -0.787474096246834,
    "previousClose": 2171.5
  },
  {
    "symbol": "NSE:M&M-EQ",
    "ticker": "M&M",
    "name": "MAHINDRA & MAHINDRA LTD",
    "price": 3313.4,
    "change": -20.6,
    "changePct": -0.617876424715057,
    "previousClose": 3334
  },
  {
    "symbol": "NSE:MAHABANK-EQ",
    "ticker": "MAHABANK",
    "name": "BANK OF MAHARASHTRA",
    "price": 82.2,
    "change": -1.6,
    "changePct": -1.909307875894988,
    "previousClose": 83.8
  },
  {
    "symbol": "NSE:MANAPPURAM-EQ",
    "ticker": "MANAPPURAM",
    "name": "MANAPPURAM FINANCE LTD",
    "price": 340.25,
    "change": -8.65,
    "changePct": -2.479220406993408,
    "previousClose": 348.9
  },
  {
    "symbol": "NSE:MANKIND-EQ",
    "ticker": "MANKIND",
    "name": "MANKIND PHARMA LIMITED",
    "price": 2352,
    "change": -30.9,
    "changePct": -1.2967392672793654,
    "previousClose": 2382.9
  },
  {
    "symbol": "NSE:MARICO-EQ",
    "ticker": "MARICO",
    "name": "MARICO LIMITED",
    "price": 829.55,
    "change": -0.1,
    "changePct": -0.012053275477611041,
    "previousClose": 829.65
  },
  {
    "symbol": "NSE:MARUTI-EQ",
    "ticker": "MARUTI",
    "name": "MARUTI SUZUKI INDIA LTD.",
    "price": 13299,
    "change": -77,
    "changePct": -0.5756578947368421,
    "previousClose": 13376
  },
  {
    "symbol": "NSE:MAXHEALTH-EQ",
    "ticker": "MAXHEALTH",
    "name": "MAX HEALTHCARE INS LTD",
    "price": 1005.7,
    "change": -8.4,
    "changePct": -0.8283206784340795,
    "previousClose": 1014.1
  },
  {
    "symbol": "NSE:MAZDOCK-EQ",
    "ticker": "MAZDOCK",
    "name": "MAZAGON DOCK SHIPBUIL LTD",
    "price": 2481.4,
    "change": -73.6,
    "changePct": -2.8806262230919764,
    "previousClose": 2555
  },
  {
    "symbol": "NSE:MCX-EQ",
    "ticker": "MCX",
    "name": "MULTI COMMODITY EXCHANGE",
    "price": 3341.3,
    "change": 9.3,
    "changePct": 0.27911164465786314,
    "previousClose": 3332
  },
  {
    "symbol": "NSE:MFSL-EQ",
    "ticker": "MFSL",
    "name": "MAX FINANCIAL SERV LTD",
    "price": 1548,
    "change": -16.4,
    "changePct": -1.048325236512401,
    "previousClose": 1564.4
  },
  {
    "symbol": "NSE:MOTHERSON-EQ",
    "ticker": "MOTHERSON",
    "name": "SAMVRDHNA MTHRSN INTL LTD",
    "price": 164.81,
    "change": -0.79,
    "changePct": -0.47705314009661837,
    "previousClose": 165.6
  },
  {
    "symbol": "NSE:MOTILALOFS-EQ",
    "ticker": "MOTILALOFS",
    "name": "MOTILAL OSWAL FIN LTD",
    "price": 1025.2,
    "change": -13.1,
    "changePct": -1.2616777424636425,
    "previousClose": 1038.3
  },
  {
    "symbol": "NSE:MPHASIS-EQ",
    "ticker": "MPHASIS",
    "name": "MPHASIS LIMITED",
    "price": 2411.5,
    "change": -43.5,
    "changePct": -1.7718940936863543,
    "previousClose": 2455
  },
  {
    "symbol": "NSE:MUTHOOTFIN-EQ",
    "ticker": "MUTHOOTFIN",
    "name": "MUTHOOT FINANCE LIMITED",
    "price": 2985.2,
    "change": -105.8,
    "changePct": -3.4228405046910386,
    "previousClose": 3091
  },
  {
    "symbol": "NSE:NAM-INDIA-EQ",
    "ticker": "NAM-INDIA",
    "name": "NIPPON L I A M LTD",
    "price": 1183.2,
    "change": -11.2,
    "changePct": -0.9377093101138647,
    "previousClose": 1194.4
  },
  {
    "symbol": "NSE:NATIONALUM-EQ",
    "ticker": "NATIONALUM",
    "name": "NATIONAL ALUMINIUM CO LTD",
    "price": 380.9,
    "change": -14.05,
    "changePct": -3.557412330674769,
    "previousClose": 394.95
  },
  {
    "symbol": "NSE:NAUKRI-EQ",
    "ticker": "NAUKRI",
    "name": "INFO EDGE (I) LTD",
    "price": 1346,
    "change": -8,
    "changePct": -0.5908419497784343,
    "previousClose": 1354
  },
  {
    "symbol": "NSE:NBCC-EQ",
    "ticker": "NBCC",
    "name": "NBCC (INDIA) LIMITED",
    "price": 85.84,
    "change": -1.66,
    "changePct": -1.8971428571428572,
    "previousClose": 87.5
  },
  {
    "symbol": "NSE:NESTLEIND-EQ",
    "ticker": "NESTLEIND",
    "name": "NESTLE INDIA LIMITED",
    "price": 1444.8,
    "change": -9.8,
    "changePct": -0.6737247353224254,
    "previousClose": 1454.6
  },
  {
    "symbol": "NSE:NHPC-EQ",
    "ticker": "NHPC",
    "name": "NHPC LTD",
    "price": 74.42,
    "change": -0.4,
    "changePct": -0.5346164127238706,
    "previousClose": 74.82
  },
  {
    "symbol": "NSE:NMDC-EQ",
    "ticker": "NMDC",
    "name": "NMDC LTD.",
    "price": 85.32,
    "change": -1.44,
    "changePct": -1.6597510373443984,
    "previousClose": 86.76
  },
  {
    "symbol": "NSE:NTPC-EQ",
    "ticker": "NTPC",
    "name": "NTPC LTD",
    "price": 325.8,
    "change": -4.25,
    "changePct": -1.287683684290259,
    "previousClose": 330.05
  },
  {
    "symbol": "NSE:NYKAA-EQ",
    "ticker": "NYKAA",
    "name": "FSN E COMMERCE VENTURES",
    "price": 336.45,
    "change": 0.8,
    "changePct": 0.23834351258751676,
    "previousClose": 335.65
  },
  {
    "symbol": "NSE:OBEROIRLTY-EQ",
    "ticker": "OBEROIRLTY",
    "name": "OBEROI REALTY LIMITED",
    "price": 1846.4,
    "change": -23.6,
    "changePct": -1.2620320855614973,
    "previousClose": 1870
  },
  {
    "symbol": "NSE:OFSS-EQ",
    "ticker": "OFSS",
    "name": "ORACLE FIN SERV SOFT LTD.",
    "price": 12202,
    "change": 12,
    "changePct": 0.09844134536505332,
    "previousClose": 12190
  },
  {
    "symbol": "NSE:OIL-EQ",
    "ticker": "OIL",
    "name": "OIL INDIA LTD",
    "price": 484.9,
    "change": 2.05,
    "changePct": 0.4245624935280108,
    "previousClose": 482.85
  },
  {
    "symbol": "NSE:ONGC-EQ",
    "ticker": "ONGC",
    "name": "OIL AND NATURAL GAS CORP.",
    "price": 232.62,
    "change": 0.37,
    "changePct": 0.15931108719052745,
    "previousClose": 232.25
  },
  {
    "symbol": "NSE:PAGEIND-EQ",
    "ticker": "PAGEIND",
    "name": "PAGE INDUSTRIES LTD",
    "price": 35555,
    "change": -430,
    "changePct": -1.1949423370848964,
    "previousClose": 35985
  },
  {
    "symbol": "NSE:PATANJALI-EQ",
    "ticker": "PATANJALI",
    "name": "PATANJALI FOODS LIMITED",
    "price": 343.45,
    "change": -5,
    "changePct": -1.4349261013057828,
    "previousClose": 348.45
  },
  {
    "symbol": "NSE:PAYTM-EQ",
    "ticker": "PAYTM",
    "name": "ONE 97 COMMUNICATIONS LTD",
    "price": 1648.3,
    "change": -2.6,
    "changePct": -0.15748985401901994,
    "previousClose": 1650.9
  },
  {
    "symbol": "NSE:PERSISTENT-EQ",
    "ticker": "PERSISTENT",
    "name": "PERSISTENT SYSTEMS LTD",
    "price": 5620,
    "change": -255,
    "changePct": -4.340425531914893,
    "previousClose": 5875
  },
  {
    "symbol": "NSE:PETRONET-EQ",
    "ticker": "PETRONET",
    "name": "PETRONET LNG LIMITED",
    "price": 290,
    "change": -2,
    "changePct": -0.684931506849315,
    "previousClose": 292
  },
  {
    "symbol": "NSE:PFC-EQ",
    "ticker": "PFC",
    "name": "POWER FIN CORP LTD.",
    "price": 348.3,
    "change": -3.7,
    "changePct": -1.0511363636363635,
    "previousClose": 352
  },
  {
    "symbol": "NSE:PGEL-EQ",
    "ticker": "PGEL",
    "name": "PG ELECTROPLAST LTD",
    "price": 573,
    "change": -12.85,
    "changePct": -2.193394213535888,
    "previousClose": 585.85
  },
  {
    "symbol": "NSE:PHOENIXLTD-EQ",
    "ticker": "PHOENIXLTD",
    "name": "THE PHOENIX MILLS LTD",
    "price": 1898.2,
    "change": -18.8,
    "changePct": -0.980699008868023,
    "previousClose": 1917
  },
  {
    "symbol": "NSE:PIDILITIND-EQ",
    "ticker": "PIDILITIND",
    "name": "PIDILITE INDUSTRIES LTD",
    "price": 1616.3,
    "change": -13.2,
    "changePct": -0.8100644369438478,
    "previousClose": 1629.5
  },
  {
    "symbol": "NSE:PIIND-EQ",
    "ticker": "PIIND",
    "name": "PI INDUSTRIES LTD",
    "price": 2391.6,
    "change": -28.5,
    "changePct": -1.1776372877153836,
    "previousClose": 2420.1
  },
  {
    "symbol": "NSE:PNB-EQ",
    "ticker": "PNB",
    "name": "PUNJAB NATIONAL BANK",
    "price": 113.25,
    "change": -2.15,
    "changePct": -1.8630849220103987,
    "previousClose": 115.4
  },
  {
    "symbol": "NSE:PNBHOUSING-EQ",
    "ticker": "PNBHOUSING",
    "name": "PNB HOUSING FIN LTD.",
    "price": 1146.3,
    "change": -23.6,
    "changePct": -2.017266433028464,
    "previousClose": 1169.9
  },
  {
    "symbol": "NSE:POLICYBZR-EQ",
    "ticker": "POLICYBZR",
    "name": "PB FINTECH LIMITED",
    "price": 1813,
    "change": 1.5,
    "changePct": 0.08280430582390284,
    "previousClose": 1811.5
  },
  {
    "symbol": "NSE:POLYCAB-EQ",
    "ticker": "POLYCAB",
    "name": "POLYCAB INDIA LIMITED",
    "price": 9027.5,
    "change": -60.5,
    "changePct": -0.6657130281690141,
    "previousClose": 9088
  },
  {
    "symbol": "NSE:POWERGRID-EQ",
    "ticker": "POWERGRID",
    "name": "POWER GRID CORP. LTD.",
    "price": 263.8,
    "change": -2.25,
    "changePct": -0.8457056944183424,
    "previousClose": 266.05
  },
  {
    "symbol": "NSE:POWERINDIA-EQ",
    "ticker": "POWERINDIA",
    "name": "HITACHI ENERGY INDIA LTD",
    "price": 32675,
    "change": -655,
    "changePct": -1.9651965196519652,
    "previousClose": 33330
  },
  {
    "symbol": "NSE:PREMIERENE-EQ",
    "ticker": "PREMIERENE",
    "name": "PREMIER ENERGIES LIMITED",
    "price": 1007.4,
    "change": -6.5,
    "changePct": -0.6410888647795641,
    "previousClose": 1013.9
  },
  {
    "symbol": "NSE:PRESTIGE-EQ",
    "ticker": "PRESTIGE",
    "name": "PRESTIGE ESTATE LTD",
    "price": 1545.9,
    "change": -42.1,
    "changePct": -2.6511335012594457,
    "previousClose": 1588
  },
  {
    "symbol": "NSE:RADICO-EQ",
    "ticker": "RADICO",
    "name": "RADICO KHAITAN LTD",
    "price": 4511.8,
    "change": -93.2,
    "changePct": -2.023887079261672,
    "previousClose": 4605
  },
  {
    "symbol": "NSE:RBLBANK-EQ",
    "ticker": "RBLBANK",
    "name": "RBL BANK LIMITED",
    "price": 378.75,
    "change": -3.25,
    "changePct": -0.8507853403141361,
    "previousClose": 382
  },
  {
    "symbol": "NSE:RECLTD-EQ",
    "ticker": "RECLTD",
    "name": "REC LIMITED",
    "price": 314.3,
    "change": -2.5,
    "changePct": -0.7891414141414141,
    "previousClose": 316.8
  },
  {
    "symbol": "NSE:RELIANCE-EQ",
    "ticker": "RELIANCE",
    "name": "RELIANCE INDUSTRIES LTD",
    "price": 1276.7,
    "change": -10.3,
    "changePct": -0.8003108003108003,
    "previousClose": 1287
  },
  {
    "symbol": "NSE:RVNL-EQ",
    "ticker": "RVNL",
    "name": "RAIL VIKAS NIGAM LIMITED",
    "price": 211.3,
    "change": -2.92,
    "changePct": -1.3630846793016524,
    "previousClose": 214.22
  },
  {
    "symbol": "NSE:SAGILITY-EQ",
    "ticker": "SAGILITY",
    "name": "SAGILITY LIMITED",
    "price": 46.28,
    "change": -0.06,
    "changePct": -0.1294777729823047,
    "previousClose": 46.34
  },
  {
    "symbol": "NSE:SAIL-EQ",
    "ticker": "SAIL",
    "name": "STEEL AUTHORITY OF INDIA",
    "price": 198.78,
    "change": -1.22,
    "changePct": -0.61,
    "previousClose": 200
  },
  {
    "symbol": "NSE:SBICARD-EQ",
    "ticker": "SBICARD",
    "name": "SBI CARDS & PAY SER LTD",
    "price": 644.6,
    "change": 3.55,
    "changePct": 0.5537789563996568,
    "previousClose": 641.05
  },
  {
    "symbol": "NSE:SBILIFE-EQ",
    "ticker": "SBILIFE",
    "name": "SBI LIFE INSURANCE CO LTD",
    "price": 1745.3,
    "change": -15.8,
    "changePct": -0.8971665436374993,
    "previousClose": 1761.1
  },
  {
    "symbol": "NSE:SBIN-EQ",
    "ticker": "SBIN",
    "name": "STATE BANK OF INDIA",
    "price": 1035.1,
    "change": -12.4,
    "changePct": -1.1837708830548925,
    "previousClose": 1047.5
  },
  {
    "symbol": "NSE:SHREECEM-EQ",
    "ticker": "SHREECEM",
    "name": "SHREE CEMENT LIMITED",
    "price": 23745,
    "change": -255,
    "changePct": -1.0625,
    "previousClose": 24000
  },
  {
    "symbol": "NSE:SHRIRAMFIN-EQ",
    "ticker": "SHRIRAMFIN",
    "name": "SHRIRAM FINANCE LIMITED",
    "price": 1062,
    "change": -24.9,
    "changePct": -2.2909191277946452,
    "previousClose": 1086.9
  },
  {
    "symbol": "NSE:SIEMENS-EQ",
    "ticker": "SIEMENS",
    "name": "SIEMENS LTD",
    "price": 4013.5,
    "change": -75.5,
    "changePct": -1.8464172169234532,
    "previousClose": 4089
  },
  {
    "symbol": "NSE:SOLARINDS-EQ",
    "ticker": "SOLARINDS",
    "name": "SOLAR INDUSTRIES (I) LTD",
    "price": 20225,
    "change": -175,
    "changePct": -0.8578431372549019,
    "previousClose": 20400
  },
  {
    "symbol": "NSE:SONACOMS-EQ",
    "ticker": "SONACOMS",
    "name": "SONA BLW PRECISION FRGS L",
    "price": 803.5,
    "change": -11.5,
    "changePct": -1.4110429447852761,
    "previousClose": 815
  },
  {
    "symbol": "NSE:SRF-EQ",
    "ticker": "SRF",
    "name": "SRF LTD",
    "price": 2561.1,
    "change": -28.8,
    "changePct": -1.1120120467971737,
    "previousClose": 2589.9
  },
  {
    "symbol": "NSE:SUNPHARMA-EQ",
    "ticker": "SUNPHARMA",
    "name": "SUN PHARMACEUTICAL IND L",
    "price": 1910.8,
    "change": -9.2,
    "changePct": -0.4791666666666667,
    "previousClose": 1920
  },
  {
    "symbol": "NSE:SUPREMEIND-EQ",
    "ticker": "SUPREMEIND",
    "name": "SUPREME INDUSTRIES LTD",
    "price": 3617.5,
    "change": -19.4,
    "changePct": -0.5334213203552476,
    "previousClose": 3636.9
  },
  {
    "symbol": "NSE:SUZLON-EQ",
    "ticker": "SUZLON",
    "name": "SUZLON ENERGY LIMITED",
    "price": 46.02,
    "change": -0.77,
    "changePct": -1.645650780081214,
    "previousClose": 46.79
  },
  {
    "symbol": "NSE:SWIGGY-EQ",
    "ticker": "SWIGGY",
    "name": "SWIGGY LIMITED",
    "price": 278.2,
    "change": -2.3,
    "changePct": -0.8199643493761141,
    "previousClose": 280.5
  },
  {
    "symbol": "NSE:TATACONSUM-EQ",
    "ticker": "TATACONSUM",
    "name": "TATA CONSUMER PRODUCT LTD",
    "price": 1031.1,
    "change": -9.6,
    "changePct": -0.9224560392043817,
    "previousClose": 1040.7
  },
  {
    "symbol": "NSE:TATAELXSI-EQ",
    "ticker": "TATAELXSI",
    "name": "TATA ELXSI LIMITED",
    "price": 3593,
    "change": -92,
    "changePct": -2.4966078697421983,
    "previousClose": 3685
  },
  {
    "symbol": "NSE:TATAPOWER-EQ",
    "ticker": "TATAPOWER",
    "name": "TATA POWER CO LTD",
    "price": 347.8,
    "change": -4.05,
    "changePct": -1.1510586897825779,
    "previousClose": 351.85
  },
  {
    "symbol": "NSE:TATASTEEL-EQ",
    "ticker": "TATASTEEL",
    "name": "TATA STEEL LIMITED",
    "price": 181.89,
    "change": -4.61,
    "changePct": -2.4718498659517425,
    "previousClose": 186.5
  },
  {
    "symbol": "NSE:TCS-EQ",
    "ticker": "TCS",
    "name": "TATA CONSULTANCY SERV LT",
    "price": 2318,
    "change": -24,
    "changePct": -1.0247651579846284,
    "previousClose": 2342
  },
  {
    "symbol": "NSE:TECHM-EQ",
    "ticker": "TECHM",
    "name": "TECH MAHINDRA LIMITED",
    "price": 1614,
    "change": -26.9,
    "changePct": -1.639344262295082,
    "previousClose": 1640.9
  },
  {
    "symbol": "NSE:TIINDIA-EQ",
    "ticker": "TIINDIA",
    "name": "TUBE INVEST OF INDIA LTD",
    "price": 2769,
    "change": -71,
    "changePct": -2.5,
    "previousClose": 2840
  },
  {
    "symbol": "NSE:TITAN-EQ",
    "ticker": "TITAN",
    "name": "TITAN COMPANY LIMITED",
    "price": 5116,
    "change": -53.2,
    "changePct": -1.0291727926951946,
    "previousClose": 5169.2
  },
  {
    "symbol": "NSE:TMPV-EQ",
    "ticker": "TMPV",
    "name": "TATA MOTORS PASS VEH LTD",
    "price": 314.75,
    "change": -4.65,
    "changePct": -1.4558547276142768,
    "previousClose": 319.4
  },
  {
    "symbol": "NSE:TORNTPHARM-EQ",
    "ticker": "TORNTPHARM",
    "name": "TORRENT PHARMACEUTICALS L",
    "price": 4943,
    "change": -107,
    "changePct": -2.118811881188119,
    "previousClose": 5050
  },
  {
    "symbol": "NSE:TRENT-EQ",
    "ticker": "TRENT",
    "name": "TRENT LTD",
    "price": 2870.9,
    "change": -27.1,
    "changePct": -0.935127674258109,
    "previousClose": 2898
  },
  {
    "symbol": "NSE:TVSMOTOR-EQ",
    "ticker": "TVSMOTOR",
    "name": "TVS MOTOR COMPANY  LTD",
    "price": 4315.1,
    "change": 10.9,
    "changePct": 0.25324102039868035,
    "previousClose": 4304.2
  },
  {
    "symbol": "NSE:ULTRACEMCO-EQ",
    "ticker": "ULTRACEMCO",
    "name": "ULTRATECH CEMENT LIMITED",
    "price": 11463,
    "change": -126,
    "changePct": -1.0872378980067305,
    "previousClose": 11589
  },
  {
    "symbol": "NSE:UNIONBANK-EQ",
    "ticker": "UNIONBANK",
    "name": "UNION BANK OF INDIA",
    "price": 181.86,
    "change": -4.14,
    "changePct": -2.225806451612903,
    "previousClose": 186
  },
  {
    "symbol": "NSE:UNITDSPR-EQ",
    "ticker": "UNITDSPR",
    "name": "UNITED SPIRITS LIMITED",
    "price": 1486,
    "change": -24,
    "changePct": -1.5894039735099337,
    "previousClose": 1510
  },
  {
    "symbol": "NSE:UNOMINDA-EQ",
    "ticker": "UNOMINDA",
    "name": "UNO MINDA LIMITED",
    "price": 1277.6,
    "change": 1.6,
    "changePct": 0.12539184952978055,
    "previousClose": 1276
  },
  {
    "symbol": "NSE:UPL-EQ",
    "ticker": "UPL",
    "name": "UPL LIMITED",
    "price": 564.25,
    "change": -6.75,
    "changePct": -1.182136602451839,
    "previousClose": 571
  },
  {
    "symbol": "NSE:VBL-EQ",
    "ticker": "VBL",
    "name": "VARUN BEVERAGES LIMITED",
    "price": 409.95,
    "change": -4.05,
    "changePct": -0.9782608695652174,
    "previousClose": 414
  },
  {
    "symbol": "NSE:VEDL-EQ",
    "ticker": "VEDL",
    "name": "VEDANTA LIMITED",
    "price": 277.95,
    "change": -10,
    "changePct": -3.4728251432540374,
    "previousClose": 287.95
  },
  {
    "symbol": "NSE:VMM-EQ",
    "ticker": "VMM",
    "name": "VISHAL MEGA MART LIMITED",
    "price": 107.71,
    "change": 0.71,
    "changePct": 0.6635514018691588,
    "previousClose": 107
  },
  {
    "symbol": "NSE:VOLTAS-EQ",
    "ticker": "VOLTAS",
    "name": "VOLTAS LTD",
    "price": 1187.8,
    "change": -12.2,
    "changePct": -1.0166666666666666,
    "previousClose": 1200
  },
  {
    "symbol": "NSE:WAAREEENER-EQ",
    "ticker": "WAAREEENER",
    "name": "WAAREE ENERGIES LIMITED",
    "price": 2576,
    "change": -64,
    "changePct": -2.4242424242424243,
    "previousClose": 2640
  },
  {
    "symbol": "NSE:WIPRO-EQ",
    "ticker": "WIPRO",
    "name": "WIPRO LTD",
    "price": 176.41,
    "change": -4.54,
    "changePct": -2.5089803813208067,
    "previousClose": 180.95
  },
  {
    "symbol": "NSE:YESBANK-EQ",
    "ticker": "YESBANK",
    "name": "YES BANK LIMITED",
    "price": 22.09,
    "change": -0.01,
    "changePct": -0.04524886877828054,
    "previousClose": 22.1
  },
  {
    "symbol": "NSE:ZYDUSLIFE-EQ",
    "ticker": "ZYDUSLIFE",
    "name": "ZYDUS LIFESCIENCES LTD",
    "price": 1160.4,
    "change": -30.6,
    "changePct": -2.5692695214105794,
    "previousClose": 1191
  }
];
