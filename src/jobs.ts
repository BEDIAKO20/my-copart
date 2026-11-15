export type ScrapeJob = {
    CATEGORY: string;
    SUBCATEGORY: string;
    SEARCH_URL: string;
};

export const SCRAPE_JOBS: ScrapeJob[] = [
    {
        CATEGORY: "Vehicles",
        SUBCATEGORY: "SUV ",
        SEARCH_URL:
            "https://www.copart.com/lotSearchResults?free=false&displayStr=AUTOMOBILE,%5B0%20TO%209999999%5D,%5B2016%20TO%202027%5D,Toyota,Rav4&from=%2FvehicleFinder&fromSource=widget&searchOrigin=vehicleFinder&qId=71902c1f-593e-4e0d-88a4-5587ebcb62ae-1794151194396&searchCriteria=%7B%22query%22:%5B%22*%22%5D,%22filter%22:%7B%22ODM%22:%5B%22odometer_reading_received:%5B0%20TO%209999999%5D%22%5D,%22YEAR%22:%5B%22lot_year:%5B2016%20TO%202027%5D%22%5D,%22VEHT%22:%5B%22vehicle_type_code:VEHTYPE_V%22%5D,%22MAKE%22:%5B%22search_lot_make_desc:%5C%22TOYOTA%5C%22%22%5D,%22MODL%22:%5B%22lot_model_desc:%5C%22RAV4%5C%22%22%5D,%22MISC%22:%5B%22bid_eligible:true%22%5D%7D,%22searchName%22:%22%22,%22watchListOnly%22:false,%22bidEligibleVehiclesOnly%22:false,%22freeFormSearch%22:false,%22exclusions%22:%5B%5D%7D",
    },
    // {
    //     CATEGORY: "Vehicles",
    //     SUBCATEGORY: "Pickup Trucks",
    //     SEARCH_URL:
    //         "https://www.copart.com/lotSearchResults?free=false&searchCriteria=%7B%22query%22:%5B%22*%22%5D,%22filter%22:%7B%22ODM%22:%5B%22odometer_reading_received:%5B0%20TO%209999999%5D%22%5D,%22YEAR%22:%5B%22lot_year:%5B2016%20TO%202027%5D%22%5D,%22MISC%22:%5B%22%23VehicleTypeCode:VEHTYPE_V%22,%22%23MakeCode:FORD%20OR%20%23MakeDesc:Ford%22,%22%23LotModel:%5C%22F150%5C%22%22%5D%7D,%22searchName%22:%22%22,%22watchListOnly%22:false,%22freeFormSearch%22:false%7D%20&displayStr=AUTOMOBILE,%5B0%20TO%209999999%5D,%5B2016%20TO%202027%5D,Ford,F150&from=%2FvehicleFinder&fromSource=widget&searchOrigin=vehicleFinder&qId=71902c1f-593e-4e0d-88a4-5587ebcb62ae-1793606345071",
    // },
];
