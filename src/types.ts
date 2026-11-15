// Shapes shared between the crawler (src/main.ts) and the database layer (src/db/).

export interface RawLot {
    lotNumber: string;
    year: string;
    make: string;
    model: string;
    title: string;
    titleCode: string;
    saleName: string;
    primaryDamage: string;
    secondaryDamage: string;
    odometer: string;
    estimatedValue: string;
    buyItNow: string;
    currentBid: string;
    startingBid: string;
    maximumBid: string;
    saleDate: string;
    location: string;
    vin: string;
    color: string;
    bodyStyle: string;
    engine: string;
    transmission: string;
    drivetrain: string;
    fuel: string;
    keys: string;
    driveability: string;
    highlights: string;
    notes: string;
    images: string[];
    url: string;
}

export interface ImageAsset {
    original: string;
    path: string;
    httpUrl: string;
    size: number;
}

export interface CurrentBid {
    lotNumber: string;
    Bidprice: string;
    BuyitNowprice: string;
    Startingbid: string;
    Maximumbid: string;
    bidNow: boolean;
    buyItNow: boolean;
    pureSale: boolean;
    auctions: boolean;
    saleDate: string;
    saleName: string;
}

export interface ProductRecord {
    url: string;
    name: string;
    currentBid: CurrentBid;
    category: string;
    subcategory: string;
    description: string;
    specs: { key: string; value: string }[];
    images: ImageAsset[];
    source: string;
    sourceId: string;
}
