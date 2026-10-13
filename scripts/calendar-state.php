<?php
require __DIR__.'/local-runtime.php';
$active = ($argv[1] ?? '') === 'active';
App\Models\CalendarConnection::query()->where('tenant_id',$fixture['tenant_id'])->update([
    'status'=>$active ? 'active' : 'reauthorization_required',
    'last_error_code'=>$active ? null : 'calendar_reauthorization_required',
    'reauthorization_required_at'=>$active ? null : now(),
]);
