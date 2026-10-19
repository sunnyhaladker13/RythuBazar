-- Where each branch is, for "near me" sorting in the browser (the visitor's location never
-- reaches the server). Sources (Oct 2026): OpenStreetMap and Google Maps pins, checked by hand.
-- "~ town" = a town or locality centre where no bazar could be found on the map. A branch with
-- no coordinates is listed in /api/status as unlocatedMarkets: fix one with
--   UPDATE markets SET lat = ..., lng = ... WHERE id = ...;
ALTER TABLE markets ADD COLUMN lat REAL;
ALTER TABLE markets ADD COLUMN lng REAL;

-- Adilabad
UPDATE markets SET lat = 19.6699, lng = 78.5348 WHERE id = 98; -- Opp: Municipal Office
-- Badradri (Kothagudem)
UPDATE markets SET lat = 17.5446, lng = 80.6171 WHERE id = 108; -- Kothagudem (P. Stdm) ~ stadium area
UPDATE markets SET lat = 17.6008, lng = 80.7037 WHERE id = 124; -- Palvancha ~ unconfirmed listing
-- Hyderabad
UPDATE markets SET lat = 17.4516, lng = 78.4353 WHERE id = 91; -- Erragadda
UPDATE markets SET lat = 17.3353, lng = 78.4684 WHERE id = 90; -- Falaknama
UPDATE markets SET lat = 17.3951, lng = 78.4411 WHERE id = 83; -- Mehdipatnam
-- Karimnagar
UPDATE markets SET lat = 18.4354, lng = 79.1186 WHERE id = 102; -- Kashmir Gadda Area
UPDATE markets SET lat = 18.4368, lng = 79.1366 WHERE id = 101; -- Weekly Market Area
-- Khammam
UPDATE markets SET lat = 17.2463, lng = 80.1717 WHERE id = 136; -- III Town
UPDATE markets SET lat = 16.929, lng = 80.3654 WHERE id = 135; -- Madhira ~ market yard
UPDATE markets SET lat = 17.253, lng = 80.1427 WHERE id = 107; -- Pavilian Ground
UPDATE markets SET lat = 17.2105, lng = 80.8374 WHERE id = 109; -- Sathupally (Ramalayam) ~ town
UPDATE markets SET lat = 17.593, lng = 80.3209 WHERE id = 123; -- Yellandu
-- Mahbubnagar
UPDATE markets SET lat = 16.7525, lng = 78.1436 WHERE id = 131; -- Badepally
UPDATE markets SET lat = 16.742, lng = 77.9905 WHERE id = 82; -- Near Rly. Gate
-- Medak
UPDATE markets SET lat = 18.0462, lng = 78.2632 WHERE id = 94; -- Medak Town ~ town
-- Medchal (Malkajgiri)
UPDATE markets SET lat = 17.506, lng = 78.5155 WHERE id = 88; -- Alwal
UPDATE markets SET lat = 17.4928, lng = 78.394 WHERE id = 84; -- Kukatpally (KPHB)
UPDATE markets SET lat = 17.6323, lng = 78.4805 WHERE id = 125; -- Medchal ~ town
UPDATE markets SET lat = 17.4735, lng = 78.5306 WHERE id = 89; -- Ramakrishnapuram
UPDATE markets SET lat = 17.5079, lng = 78.4105 WHERE id = 127; -- Yellammabanda
-- Nagarkurnool
UPDATE markets SET lat = 16.4855, lng = 78.3173 WHERE id = 116; -- Nagarkurnool ~ town
-- Nalgonda
UPDATE markets SET lat = 17.0652, lng = 79.2658 WHERE id = 128; -- Beet Market, Hyd Road
UPDATE markets SET lat = 16.8695, lng = 79.5608 WHERE id = 111; -- Miryalaguda (NSP Camp)
UPDATE markets SET lat = 17.0505, lng = 79.2645 WHERE id = 110; -- Ursu Premises ~ town (the bazar on the map is Beet Market's)
-- Narayanpet
UPDATE markets SET lat = 16.7477, lng = 77.493 WHERE id = 130; -- Narayanpet ~ town
-- Nizamabad
UPDATE markets SET lat = 18.6878, lng = 78.107 WHERE id = 97; -- NGOs Colony
UPDATE markets SET lat = 18.6668, lng = 78.1027 WHERE id = 96; -- Pullanga X Road
-- Rangareddy
UPDATE markets SET lat = 17.3148, lng = 78.1404 WHERE id = 140; -- Chevella
UPDATE markets SET lat = 17.3661, lng = 78.5424 WHERE id = 85; -- Saroornagar (the Kothapet bazar)
UPDATE markets SET lat = 17.3306, lng = 78.5754 WHERE id = 86; -- Vanasthalipuram
-- Sanga Reddy
UPDATE markets SET lat = 17.837, lng = 78.068 WHERE id = 137; -- Jogipet ~ town
UPDATE markets SET lat = 18.0377, lng = 77.7783 WHERE id = 141; -- Narayankhed
-- Siddipet
UPDATE markets SET lat = 18.1016, lng = 78.848 WHERE id = 95; -- Siddipet Town
-- Suryapet
UPDATE markets SET lat = 16.9947, lng = 79.975 WHERE id = 112; -- Kodad ~ town
UPDATE markets SET lat = 17.1417, lng = 79.6204 WHERE id = 113; -- Suryapet ~ town
-- Vikarabad
UPDATE markets SET lat = 17.3417, lng = 77.9066 WHERE id = 122; -- Vikarabad
-- Warangal
UPDATE markets SET lat = 17.9973, lng = 79.5405 WHERE id = 104; -- Excise Colony
UPDATE markets SET lat = 17.9283, lng = 79.5889 WHERE id = 106; -- Laxmipuram (M.Y.) ~ locality
-- Yadadri (Bhongir)
UPDATE markets SET lat = 17.5159, lng = 78.8852 WHERE id = 114; -- Bhongir
