import{c,D as s,Z as a}from"./index-DOUMTOa0.js";/**
 * @license lucide-vue-next v1.0.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const n=c("shopping-cart",[["circle",{cx:"8",cy:"21",r:"1",key:"jimo8o"}],["circle",{cx:"19",cy:"21",r:"1",key:"13723u"}],["path",{d:"M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12",key:"9zh506"}]]);async function u(o,r){const e=await fetch(`${s}/api/v1/orders/quote`,{method:"POST",headers:{"Content-Type":"application/json",...a()},body:JSON.stringify(o),signal:r}),t=await e.json().catch(()=>null);if(!e.ok||!(t!=null&&t.success))throw new Error((t==null?void 0:t.error)||`주문 금액을 계산하지 못했습니다 (${e.status})`);return t.data}function h(o){const r={};for(const e of o.sub_orders)for(const t of e.items)r[t.sku_id]=Number(t.base_unit_price);return r}export{n as S,u as f,h as q};
