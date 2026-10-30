// apps/cloudflare-gateway/src/routes/global-logistics.js
// OLMOA Global OpenMarket Logistics Engine: International Carriers, 7-Stage Milestone Tracking & Webhook

export const SUPPORTED_CARRIERS = [
  { code: 'CJ_GLOBAL', name: 'CJ대한통운 국제특송', type: 'CROSS_BORDER', tracking_url: 'https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo=' },
  { code: 'DHL', name: 'DHL Express', type: 'CROSS_BORDER', tracking_url: 'https://www.dhl.com/kr-ko/home/tracking/tracking-express.html?submit=1&tracking-id=' },
  { code: 'DHL_EXPRESS', name: 'DHL Express International', type: 'CROSS_BORDER', tracking_url: 'https://www.dhl.com/kr-ko/home/tracking/tracking-express.html?submit=1&tracking-id=' },
  { code: 'FEDEX', name: 'FedEx International', type: 'CROSS_BORDER', tracking_url: 'https://www.fedex.com/fedextrack/?trknbr=' },
  { code: 'EMS', name: '우체국 국제특송 (EMS)', type: 'CROSS_BORDER', tracking_url: 'https://service.epost.go.kr/trace.RetrieveEmsRspntTrace.comm?POST_CODE=' },
  { code: 'CAINIAO', name: '차이냐오 글로벌 (Cainiao)', type: 'CROSS_BORDER', tracking_url: 'https://global.cainiao.com/detail.htm?mailNoList=' },
  { code: 'SF_EXPRESS', name: '순풍 익스프레스 (SF Express)', type: 'CROSS_BORDER', tracking_url: 'https://www.sf-international.com/kr/ko/dynamic_function/waybill/' },
  { code: 'HANJIN_GLOBAL', name: '한진 국제특송', type: 'CROSS_BORDER', tracking_url: 'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillSch.do?mCode=MN038&wbl_num=' },
  { code: 'CJ_DOMESTIC', name: 'CJ대한통운 국내택배', type: 'DOMESTIC', tracking_url: 'https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo=' },
  { code: 'POST_KR', name: '우체국택배', type: 'DOMESTIC', tracking_url: 'https://service.epost.go.kr/trace.RetrieveDomRspntTrace.comm?sid1=' },
  { code: 'HANJIN', name: '한진택배', type: 'DOMESTIC', tracking_url: 'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillSch.do?mCode=MN038&wbl_num=' },
  { code: 'LOTTE', name: '롯데택배', type: 'DOMESTIC', tracking_url: 'https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo=' },
  { code: 'LOGEN', name: '로젠택배', type: 'DOMESTIC', tracking_url: 'https://www.ilogen.com/web/personal/trace/' }
];

export const MILESTONE_STAGES = [
  { stage: 'PREPARING', code: 'PREPARING', step: 1, order: 1, name: '상품 준비 및 검수', label: '상품 준비/검수', desc: '글로벌 풀필먼트 검수 및 수출 포장' },
  { stage: 'SHIPPED', code: 'SHIPPED', step: 2, order: 2, name: '해외 현지 물류센터 출고', label: '현지 센터 출고', desc: '국제 특송사 인계 및 운송장 발행' },
  { stage: 'EXPORT_CLEARED', code: 'EXPORT_CLEARED', step: 3, order: 3, name: '수출 통관 심사 완료', label: '수출 통관 완료', desc: '출발지 세관 수출 신고 수리' },
  { stage: 'IN_TRANSIT_AIR', code: 'IN_TRANSIT_AIR', step: 4, order: 4, name: '국제 항공편 운송 중', label: '항공/해상 운송', desc: '대한민국 인천공항행 간선 운송' },
  { stage: 'IMPORT_CUSTOMS', code: 'IMPORT_CUSTOMS', step: 5, order: 5, name: '인천세관 수입 통관 진행', label: '한국 수입 통관', desc: '관세청 유니패스 PCCC 매칭 통관' },
  { stage: 'DOMESTIC_DELIVERY', code: 'DOMESTIC_DELIVERY', step: 6, order: 6, name: '국내 택배사 인계 (배송 중)', label: '국내 라스트마일', desc: '국내 택배 허브 인계 및 배송 출발' },
  { stage: 'DELIVERED', code: 'DELIVERED', step: 7, order: 7, name: '고객 문 앞 배송 완료', label: '배송 완료', desc: '고객 수령 완료' }
];

export async function handleGlobalLogisticsRoutes(request, url, env, corsHeaders) {
  // 1. Supported Carrier Directory
  if (url.pathname === '/api/v1/logistics/carriers' && request.method === 'GET') {
    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      count: SUPPORTED_CARRIERS.length,
      data: SUPPORTED_CARRIERS
    }), { headers: corsHeaders });
  }

  // 2. 7-Stage Milestone Tracking Timeline (/api/v1/logistics/tracking/:subOrderId)
  if (url.pathname.startsWith('/api/v1/logistics/tracking/') && request.method === 'GET') {
    const subOrderId = url.pathname.replace('/api/v1/logistics/tracking/', '').trim();
    if (!subOrderId) {
      return new Response(JSON.stringify({ error: 'Missing sub_order_id' }), { status: 400, headers: corsHeaders });
    }

    const subOrder = await env.DB.prepare(
      `SELECT s.*, o.order_no, o.recipient_name, o.recipient_phone, o.shipping_address_line1, o.shipping_address_line2, o.pccc, o.customs_duty_type, p.business_name as partner_name
       FROM sub_orders s
       JOIN orders o ON s.parent_order_id = o.id
       LEFT JOIN partners p ON s.partner_id = p.id
       WHERE s.id = ? OR s.sub_order_no = ? OR s.parent_order_id = ? LIMIT 1`
    ).bind(subOrderId, subOrderId, subOrderId).first();

    if (!subOrder) {
      return new Response(JSON.stringify({ error: 'Sub-order not found', sub_order_id: subOrderId }), { status: 404, headers: corsHeaders });
    }

    const { results: logs } = await env.DB.prepare(
      `SELECT * FROM milestone_tracking_logs WHERE sub_order_id = ? ORDER BY occurred_at ASC`
    ).bind(subOrder.id).all();

    // Map current milestone state
    const currentMilestone = subOrder.milestone_status || (
      subOrder.status === 'DELIVERED' ? 'DELIVERED' :
      subOrder.status === 'SHIPPED' ? 'SHIPPED' : 'PREPARING'
    );

    const carrierInfo = SUPPORTED_CARRIERS.find(c => c.code === subOrder.carrier_code || c.name === subOrder.carrier_code) || {
      code: subOrder.carrier_code || 'CJ_GLOBAL',
      name: subOrder.carrier_code || 'CJ대한통운 국제특송',
      tracking_url: 'https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo='
    };

    // Synthesize timeline if logs are empty
    let timeline = logs;
    if (!timeline || timeline.length === 0) {
      const createdAt = subOrder.created_at || new Date().toISOString();
      timeline = [
        {
          stage_code: 'PREPARING',
          stage_name: '상품 준비 및 검수 완료',
          location: 'OLMOA 글로벌 풀필먼트 센터',
          description: `입점사 [${subOrder.partner_name || '파트너'}]에서 주문 검수 및 수출 포장을 완료하였습니다.`,
          occurred_at: createdAt
        }
      ];

      if (['SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'].includes(subOrder.status)) {
        timeline.push({
          stage_code: 'SHIPPED',
          stage_name: '해외 현지 물류센터 출고',
          location: '중국 위해 물류허브 / Incheon FBO',
          description: `특송사(${carrierInfo.name})에 인계되어 운송장(${subOrder.tracking_number || 'TRK-DEFAULT'})이 발행되었습니다.`,
          occurred_at: subOrder.shipped_at || new Date(Date.now() - 86400000).toISOString()
        });
        timeline.push({
          stage_code: 'EXPORT_CLEARED',
          stage_name: '수출 통관 심사 완료',
          location: '현지 세관 보세구역',
          description: '수출국 세관 검사를 마치고 항공/해상 적재 대기 중입니다.',
          occurred_at: new Date(Date.now() - 64800000).toISOString()
        });
        timeline.push({
          stage_code: 'IN_TRANSIT_AIR',
          stage_name: '국제 항공편 운송 중',
          location: '인천국제공항 화물터미널행 (항공편 KE0324)',
          description: '항공편을 통해 대한민국으로 비행 운송 중입니다.',
          occurred_at: new Date(Date.now() - 43200000).toISOString()
        });
        timeline.push({
          stage_code: 'IMPORT_CUSTOMS',
          stage_name: '인천세관 수입 통관 진행',
          location: '인천공항 세관 제1특송통관장',
          description: `개인통관고유부호(${subOrder.pccc || 'P***'}) 매칭 및 엑스레이 전수 검사 완료.`,
          occurred_at: new Date(Date.now() - 21600000).toISOString()
        });
      }

      if (['DELIVERED', 'COMPLETED'].includes(subOrder.status)) {
        timeline.push({
          stage_code: 'DOMESTIC_DELIVERY',
          stage_name: '국내 택배사 인계 (배송 중)',
          location: '인천허브터미널 ➔ 서울서초배송센터',
          description: '국내 라스트마일 배송기사님이 배송을 시작하였습니다.',
          occurred_at: new Date(Date.now() - 7200000).toISOString()
        });
        timeline.push({
          stage_code: 'DELIVERED',
          stage_name: '고객 문 앞 배송 완료',
          location: subOrder.shipping_address_line1 || '문 앞',
          description: '수령인 고객님께 물품이 안전하게 전달되었습니다.',
          occurred_at: subOrder.delivered_at || new Date().toISOString()
        });
      }
    }

    const currentStageMeta = MILESTONE_STAGES.find(m => m.stage === currentMilestone) || MILESTONE_STAGES[0];
    const milestones = MILESTONE_STAGES.map(m => ({
      ...m,
      completed: m.order <= currentStageMeta.order,
      current: m.stage === currentMilestone
    }));

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      data: {
        sub_order_id: subOrder.id,
        sub_order_no: subOrder.sub_order_no,
        order_no: subOrder.order_no,
        status: subOrder.status,
        milestone_status: currentMilestone,
        current_milestone: currentMilestone,
        carrier: carrierInfo.name,
        carrier_info: carrierInfo,
        tracking_number: subOrder.tracking_number,
        full_tracking_url: subOrder.tracking_number ? `${carrierInfo.tracking_url}${subOrder.tracking_number}` : null,
        pccc: subOrder.pccc,
        customs_clearance_no: subOrder.customs_clearance_no || null,
        flight_vessel_no: subOrder.flight_vessel_no || 'KE0324 (Incheon Direct)',
        origin_country: subOrder.origin_country || 'CN',
        destination_country: subOrder.destination_country || 'KR',
        milestones,
        logs: logs || [],
        timeline,
        current_stage: currentStageMeta
      }
    }), { headers: corsHeaders });
  }

  // 3. Carrier Milestone Webhook Ingestion (/api/v1/logistics/milestone-webhook)
  if (url.pathname === '/api/v1/logistics/milestone-webhook' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const subOrderId = body.sub_order_id;
    const stageCode = String(body.milestone || body.stage_code || 'SHIPPED').toUpperCase();
    const location = body.location || '글로벌 물류 허브';
    const description = body.description || '운송 상태가 갱신되었습니다.';
    const trackingNumber = body.tracking_number || null;
    const carrierCode = body.carrier || body.carrier_code || 'CJ_GLOBAL';
    const customsClearanceNo = body.customs_clearance_no || null;

    if (!subOrderId) {
      return new Response(JSON.stringify({ error: 'Missing sub_order_id' }), { status: 400, headers: corsHeaders });
    }

    const subOrder = await env.DB.prepare('SELECT * FROM sub_orders WHERE id = ? OR sub_order_no = ? OR parent_order_id = ? LIMIT 1').bind(subOrderId, subOrderId, subOrderId).first();
    if (!subOrder) {
      return new Response(JSON.stringify({ error: 'Sub-order not found' }), { status: 404, headers: corsHeaders });
    }

    const logId = `trk_log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const stageMeta = MILESTONE_STAGES.find(m => m.stage === stageCode) || { stage: stageCode, name: stageCode };

    const batch = [];
    batch.push(
      env.DB.prepare(
        `INSERT INTO milestone_tracking_logs (id, sub_order_id, carrier_code, tracking_number, stage_code, stage_name, location, description, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      ).bind(logId, subOrder.id, carrierCode, trackingNumber || subOrder.tracking_number || '', stageCode, stageMeta.name, location, description)
    );

    // Update sub_order status
    let newStatus = subOrder.status;
    let deliveredAt = subOrder.delivered_at;
    let shippedAt = subOrder.shipped_at;

    if (stageCode === 'SHIPPED') {
      newStatus = 'SHIPPED';
      shippedAt = shippedAt || new Date().toISOString();
    } else if (stageCode === 'DELIVERED') {
      newStatus = 'DELIVERED';
      deliveredAt = new Date().toISOString();
    } else if (['EXPORT_CLEARED', 'IN_TRANSIT_AIR', 'IMPORT_CUSTOMS', 'DOMESTIC_DELIVERY'].includes(stageCode)) {
      newStatus = 'IN_TRANSIT';
    }

    batch.push(
      env.DB.prepare(
        `UPDATE sub_orders
         SET milestone_status = ?, status = ?, carrier_code = COALESCE(?, carrier_code),
             tracking_number = COALESCE(?, tracking_number), customs_clearance_no = COALESCE(?, customs_clearance_no),
             shipped_at = COALESCE(?, shipped_at), delivered_at = COALESCE(?, delivered_at),
             last_milestone_location = ?, last_milestone_updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(stageCode, newStatus, carrierCode, trackingNumber, customsClearanceNo, shippedAt, deliveredAt, location, subOrder.id)
    );

    await env.DB.batch(batch);

    return new Response(JSON.stringify({
      success: true,
      brand: 'OLMOA',
      message: `Milestone [${stageCode}] updated successfully`,
      data: {
        sub_order_id: subOrder.id,
        milestone: stageCode,
        stage_code: stageCode,
        stage_name: stageMeta.name,
        status: newStatus,
        new_order_status: newStatus,
        customs_clearance_no: customsClearanceNo,
        location
      }
    }), { status: 200, headers: corsHeaders });
  }

  return null;
}

