-- migrations/d1_09b_subcategories_part2.sql
-- L2 Subcategories for Existing 22 Categories with zero subcategories

INSERT OR IGNORE INTO categories (id, parent_id, name, slug, depth, sort_order) VALUES
('sub_bed_01', 'cat_bedding', '이불커버 & 침구세트', 'duvet-sets', 1, 1),
('sub_bed_02', 'cat_bedding', '베개 & 쿠션', 'pillows-cushions', 1, 2),
('sub_bed_03', 'cat_bedding', '담요 & 블랭킷', 'blankets-throws', 1, 3),
('sub_bed_04', 'cat_bedding', '바스타올 & 샤워가운', 'towels-robes', 1, 4),

('sub_fur_01', 'cat_furniture', '거실 소파 & 테이블', 'living-room-furniture', 1, 1),
('sub_fur_02', 'cat_furniture', '홈오피스 책상 & 의자', 'office-furniture', 1, 2),
('sub_fur_03', 'cat_furniture', '게이밍 체어 & 데스크', 'gaming-furniture', 1, 3),
('sub_fur_04', 'cat_furniture', '신발장 & 현관수납', 'entryway-storage-furniture', 1, 4),

('sub_app_01', 'cat_appliances', '소형 생활가전', 'small-home-appliances', 1, 1),
('sub_app_02', 'cat_appliances', '로봇 & 무선청소기', 'vacuums-floor-care', 1, 2),
('sub_app_03', 'cat_appliances', '주방 조리가전/에어프라이어', 'kitchen-appliances', 1, 3),
('sub_app_04', 'cat_appliances', '공기청정기 & 가습기', 'air-quality-appliances', 1, 4),

('sub_cel_01', 'cat_cellphones', '스마트폰 케이스/맥세이프', 'phone-cases', 1, 1),
('sub_cel_02', 'cat_cellphones', '액정보호 강화유리/필름', 'screen-protectors', 1, 2),
('sub_cel_03', 'cat_cellphones', '고속 충전기 & GaN 어댑터', 'chargers-power', 1, 3),
('sub_cel_04', 'cat_cellphones', '대용량 보조배터리', 'power-banks', 1, 4),
('sub_cel_05', 'cat_cellphones', '스마트폰 거치대 & 삼각대', 'phone-stands-rigs', 1, 5),

('sub_smh_01', 'cat_smart_home', '스마트 플러그 & 스위치', 'smart-plugs', 1, 1),
('sub_smh_02', 'cat_smart_home', '스마트 LED 조명 & 스트립', 'smart-lighting', 1, 2),
('sub_smh_03', 'cat_smart_home', '스마트 도어락 & 센서', 'smart-doorbells-locks', 1, 3),
('sub_smh_04', 'cat_smart_home', 'Wi-Fi 유무선 공유기', 'wifi-networking', 1, 4),

('sub_hlt_01', 'cat_health', '마사지건 & 안마기', 'electric-massagers', 1, 1),
('sub_hlt_02', 'cat_health', '바른자세 교정 & 보호대', 'posture-orthopedic', 1, 2),
('sub_hlt_03', 'cat_health', '구강청결기 & 전동칫솔', 'oral-dental-care', 1, 3),
('sub_hlt_04', 'cat_health', '혈압계 & 체온계/건강측정', 'health-monitors', 1, 4),

('sub_bby_01', 'cat_baby', '신생아 의류 & 배냇저고리', 'baby-apparel', 1, 1),
('sub_bby_02', 'cat_baby', '젖병 & 수유용품', 'baby-feeding', 1, 2),
('sub_bby_03', 'cat_baby', '기저귀가방 & 정리함', 'diapering-care', 1, 3),
('sub_bby_04', 'cat_baby', '유모차 & 카시트 악세서리', 'strollers-travel', 1, 4),

('sub_pet_01', 'cat_pet', '강아지 의류 & 하네스', 'dog-apparel-leashes', 1, 1),
('sub_pet_02', 'cat_pet', '고양이 캣타워 & 스크래쳐', 'cat-toys-furniture', 1, 2),
('sub_pet_03', 'cat_pet', '자동급식기 & 정수기', 'pet-feeders-bowls', 1, 3),
('sub_pet_04', 'cat_pet', '반려동물 침대 & 쿨매트', 'pet-beds', 1, 4),

('sub_ofc_01', 'cat_office', '필기구 & 펜/마커', 'pens-writing', 1, 1),
('sub_ofc_02', 'cat_office', '다이어리 & 노트/메모', 'notebooks-planners', 1, 2),
('sub_ofc_03', 'cat_office', '데스크 오거나이저/정리함', 'desk-organizers', 1, 3),
('sub_ofc_04', 'cat_office', '라벨프린터 & 사무기기', 'office-electronics', 1, 4),

('sub_bks_01', 'cat_books', '컬러링북 & 액티비티', 'activity-coloring-books', 1, 1),
('sub_bks_02', 'cat_books', '어학 & 수험학습서', 'education-books', 1, 2),
('sub_bks_03', 'cat_books', '독서대 & 북라이트', 'reading-accessories', 1, 3),

('sub_crf_01', 'cat_crafts', '아크릴 & 유화 드로잉 세트', 'painting-drawing', 1, 1),
('sub_crf_02', 'cat_crafts', '보석십자수 & 자수세트', 'diamond-painting', 1, 2),
('sub_crf_03', 'cat_crafts', '레진아트 & 비즈공예', 'beading-jewelry-making', 1, 3),
('sub_crf_04', 'cat_crafts', '뜨개질 & 털실 키트', 'knitting-crochet', 1, 4),

('sub_tol_01', 'cat_tools', '충전 전동드릴 & 공구세트', 'power-tools', 1, 1),
('sub_tol_02', 'cat_tools', '정밀 드라이버 & 수공구', 'hand-tools', 1, 2),
('sub_tol_03', 'cat_tools', '작업용 LED 랜턴/투광등', 'work-lighting', 1, 3),
('sub_tol_04', 'cat_tools', '인테리어 타일스티커 & 접착', 'wall-renovation', 1, 4),

('sub_ptg_01', 'cat_patio', '원예용 수공구 & 작업장갑', 'gardening-tools', 1, 1),
('sub_ptg_02', 'cat_patio', '태양광 정원등/조경조명', 'solar-garden-lights', 1, 2),
('sub_ptg_03', 'cat_patio', '화분 & 자동급수 화분', 'planters-pots', 1, 3),
('sub_ptg_04', 'cat_patio', '바베큐 그릴 & 캠핑조리', 'bbq-outdoor-cooking', 1, 4),

('sub_fod_01', 'cat_food', '견과류 & 프리미엄 스낵', 'nuts-snacks', 1, 1),
('sub_fod_02', 'cat_food', '원두커피 & 건강 블렌딩티', 'coffee-tea-beverages', 1, 2),
('sub_fod_03', 'cat_food', '단백질 쉐이크 & 헬스스낵', 'diet-sports-nutrition', 1, 3),

('sub_gam_01', 'cat_gaming', '기계식 게이밍 키보드/마우스', 'gaming-keyboards-mice', 1, 1),
('sub_gam_02', 'cat_gaming', '무선 게임패드 & 컨트롤러', 'game-controllers', 1, 2),
('sub_gam_03', 'cat_gaming', '게이밍 헤드셋 & 스탠드', 'gaming-headsets', 1, 3),
('sub_gam_04', 'cat_gaming', '레트로 휴대용 게임기', 'retro-handheld-consoles', 1, 4),

('sub_mus_01', 'cat_music', '칼림바 & 미니 우쿨렐레', 'kalimba-ukulele', 1, 1),
('sub_mus_02', 'cat_music', '기타 튜너, 카포 & 스트링', 'guitar-accessories', 1, 2),
('sub_mus_03', 'cat_music', '콘덴서 마이크 & 오디오인터페이스', 'studio-recording-audio', 1, 3),

('sub_sec_01', 'cat_security', '실내 가정용 홈캠/IP카메라', 'indoor-cctv', 1, 1),
('sub_sec_02', 'cat_security', '야외 태양광 무선 CCTV', 'outdoor-security-cams', 1, 2),
('sub_sec_03', 'cat_security', '스마트 인터폰 & 비디오벨', 'video-intercoms', 1, 3),

('sub_trv_01', 'cat_travel', '압축 트래블 파우치 세트', 'packing-cubes', 1, 1),
('sub_trv_02', 'cat_travel', '메모리폼 목베개 & 안대', 'travel-comfort', 1, 2),
('sub_trv_03', 'cat_travel', 'RFID 여권지갑 & 캐리어벨트', 'passport-rfid-wallets', 1, 3),

('sub_wat_01', 'cat_watches', '남성 쿼츠 & 메탈 시계', 'mens-watches', 1, 1),
('sub_wat_02', 'cat_watches', '여성 가죽밴드 패션시계', 'womens-watches', 1, 2),
('sub_wat_03', 'cat_watches', '스마트워치 스트랩 & 케이스', 'watches-straps', 1, 3),

('sub_pty_01', 'cat_party', '생일 파티 풍선가랜드 세트', 'birthday-balloons', 1, 1),
('sub_pty_02', 'cat_party', '브라이덜샤워 & 홈파티 장식', 'wedding-party-decor', 1, 2),
('sub_pty_03', 'cat_party', '시즌 크리스마스/할로윈 소품', 'seasonal-holiday-decor', 1, 3),

('sub_ind_01', 'cat_industrial', '디지털 버니어캘리퍼스 & 계측기', 'test-measure-inspect', 1, 1),
('sub_ind_02', 'cat_industrial', '3D 프린터 필라멘트 & 노즐', '3d-printing-supplies', 1, 2),
('sub_ind_03', 'cat_industrial', '산업용 안전화 & 보호장구', 'work-safety-ppe', 1, 3),

('sub_gft_01', 'cat_giftcards', '올모아 모바일 디지털 상품권', 'olmoa-gift-vouchers', 1, 1),
('sub_gft_02', 'cat_giftcards', 'VIP 멤버십 패스', 'vip-membership-passes', 1, 2);

