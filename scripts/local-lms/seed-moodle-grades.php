<?php

define('CLI_SCRIPT', true);
require('/var/www/html/config.php');
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->dirroot . '/course/modlib.php');
require_once($CFG->dirroot . '/lib/resourcelib.php');
require_once($CFG->dirroot . '/user/lib.php');
require_once($CFG->libdir . '/gradelib.php');
require_once($CFG->libdir . '/externallib.php');

// Enrollment event handlers can print local mail warnings in CLI mode. Keep
// stdout machine-readable because the Node wrapper consumes the final JSON.
ob_start();

$students = [
    ['username' => 'avery.gupta38', 'email' => 'avery.gupta38@student.ubc.ca', 'firstname' => 'Avery', 'lastname' => 'Gupta'],
    ['username' => 'bio_student', 'email' => 'bio_student@student.ubc.ca', 'firstname' => 'Bruno', 'lastname' => 'Student'],
    ['username' => 'cameron.patel43', 'email' => 'cameron.patel43@student.ubc.ca', 'firstname' => 'Cameron', 'lastname' => 'Patel'],
    ['username' => 'casey.ali36', 'email' => 'casey.ali36@student.ubc.ca', 'firstname' => 'Casey', 'lastname' => 'Ali'],
    ['username' => 'devon.wong44', 'email' => 'devon.wong44@student.ubc.ca', 'firstname' => 'Devon', 'lastname' => 'Wong'],
];

$scores = [
    'avery.gupta38' => [88, 92, 84],
    'bio_student' => [73, 81, 78],
    'cameron.patel43' => [95, 89, 93],
    'casey.ali36' => [82, 76, 87],
    'devon.wong44' => [68, 74, 71],
];

$items = [
    ['name' => 'Protein Structure Quiz', 'idnumber' => 'biocbot-protein-quiz', 'max' => 100],
    ['name' => 'Enzyme Kinetics Assignment', 'idnumber' => 'biocbot-enzyme-assignment', 'max' => 100],
    ['name' => 'Metabolism Midterm', 'idnumber' => 'biocbot-metabolism-midterm', 'max' => 100],
];

$course = $DB->get_record('course', ['idnumber' => 'BIOC-302-LOCAL-GRADES']);
if (!$course) {
    $course = create_course((object) [
        'fullname' => 'BIOC 302 - General Biochemistry',
        'shortname' => 'BIOC302-LOCAL',
        'idnumber' => 'BIOC-302-LOCAL-GRADES',
        'category' => 1,
        'visible' => 1,
        'format' => 'topics',
    ]);
}

$manual = enrol_get_plugin('manual');
$manualinstance = null;
foreach (enrol_get_instances($course->id, true) as $instance) {
    if ($instance->enrol === 'manual') {
        $manualinstance = $instance;
        break;
    }
}
if (!$manualinstance) {
    $instanceid = $manual->add_instance($course);
    $manualinstance = $DB->get_record('enrol', ['id' => $instanceid], '*', MUST_EXIST);
}
$studentrole = $DB->get_record('role', ['shortname' => 'student'], '*', MUST_EXIST);
$teacherrole = $DB->get_record('role', ['shortname' => 'editingteacher'], '*', MUST_EXIST);
$admin = $DB->get_record('user', ['username' => 'admin', 'mnethostid' => $CFG->mnet_localhost_id], '*', MUST_EXIST);
$manual->enrol_user($manualinstance, $admin->id, $teacherrole->id, 0, 0, ENROL_USER_ACTIVE);

$userids = [];
foreach ($students as $studentdata) {
    $user = $DB->get_record('user', ['username' => $studentdata['username'], 'mnethostid' => $CFG->mnet_localhost_id]);
    if (!$user) {
        $record = (object) array_merge($studentdata, [
            'auth' => 'manual',
            'confirmed' => 1,
            'mnethostid' => $CFG->mnet_localhost_id,
            'password' => 'Password1!',
        ]);
        $userid = user_create_user($record, true, false);
        $user = $DB->get_record('user', ['id' => $userid], '*', MUST_EXIST);
    }
    $manual->enrol_user($manualinstance, $user->id, $studentrole->id, 0, 0, ENROL_USER_ACTIVE);
    $userids[$studentdata['username']] = (int) $user->id;
}

$gradeitemids = [];
foreach ($items as $index => $itemdata) {
    $gradeitem = grade_item::fetch([
        'courseid' => $course->id,
        'itemtype' => 'manual',
        'idnumber' => $itemdata['idnumber'],
    ]);
    if (!$gradeitem) {
        $gradeitem = new grade_item();
        $gradeitem->courseid = $course->id;
        $gradeitem->itemtype = 'manual';
        $gradeitem->itemname = $itemdata['name'];
        $gradeitem->idnumber = $itemdata['idnumber'];
        $gradeitem->gradetype = GRADE_TYPE_VALUE;
        $gradeitem->grademin = 0;
        $gradeitem->grademax = $itemdata['max'];
        $gradeitem->insert('biocbot_local_seed');
    }
    $gradeitemids[$itemdata['idnumber']] = (int) $gradeitem->id;
    foreach ($userids as $username => $userid) {
        $gradeitem->update_final_grade($userid, $scores[$username][$index], 'biocbot_local_seed');
    }
}
grade_regrade_final_grades($course->id);

$notes = [
    [
        'name' => 'BIOC 302 Protein Structure Notes',
        'filename' => 'BIOC-302-protein-structure-notes.txt',
        'content' => "BIOC 302 - Protein Structure Notes\n\nProteins fold into primary, secondary, tertiary, and quaternary structures.\nHydrogen bonds stabilize alpha helices and beta sheets, while hydrophobic interactions help drive tertiary folding.\nDenaturation disrupts higher-order structure without necessarily breaking peptide bonds.\n",
    ],
    [
        'name' => 'BIOC 302 Enzyme Kinetics Notes',
        'filename' => 'BIOC-302-enzyme-kinetics-notes.txt',
        'content' => "BIOC 302 - Enzyme Kinetics Notes\n\nThe Michaelis-Menten model relates reaction velocity to substrate concentration.\nVmax is approached at saturating substrate, and Km is the substrate concentration at half Vmax.\nCompetitive inhibitors increase apparent Km without changing Vmax.\n",
    ],
];
\core\session\manager::set_user($admin);
$usercontext = context_user::instance($admin->id);
foreach ($notes as $note) {
    if ($DB->record_exists('resource', ['course' => $course->id, 'name' => $note['name']])) {
        continue;
    }
    $draftid = file_get_unused_draft_itemid();
    get_file_storage()->create_file_from_string([
        'component' => 'user',
        'filearea' => 'draft',
        'contextid' => $usercontext->id,
        'itemid' => $draftid,
        'filename' => $note['filename'],
        'filepath' => '/',
    ], $note['content']);

    [, , , , $moduleinfo] = prepare_new_moduleinfo_data($course, 'resource', 1);
    $moduleinfo->name = $note['name'];
    $moduleinfo->intro = 'A local Moodle note used to verify BiocBot file import.';
    $moduleinfo->introformat = FORMAT_HTML;
    $moduleinfo->files = $draftid;
    $moduleinfo->display = RESOURCELIB_DISPLAY_AUTO;
    $moduleinfo->printintro = 0;
    $moduleinfo->showsize = 1;
    $moduleinfo->showtype = 1;
    $moduleinfo->showdate = 0;
    add_moduleinfo($moduleinfo, $course);
}

$service = $DB->get_record('external_services', ['shortname' => 'biocbot_local']);
if (!$service) {
    $serviceid = $DB->insert_record('external_services', (object) [
        'name' => 'BiocBot local development',
        'shortname' => 'biocbot_local',
        'enabled' => 1,
        'restrictedusers' => 0,
        'requiredcapability' => '',
        'downloadfiles' => 1,
        'uploadfiles' => 0,
        'timecreated' => time(),
        'timemodified' => time(),
    ]);
    $service = $DB->get_record('external_services', ['id' => $serviceid], '*', MUST_EXIST);
}

$functions = [
    'core_webservice_get_site_info',
    'core_enrol_get_users_courses',
    'core_group_get_course_groups',
    'core_course_get_contents',
    'gradereport_user_get_grade_items',
];
foreach ($functions as $functionname) {
    if (!$DB->record_exists('external_services_functions', ['externalserviceid' => $service->id, 'functionname' => $functionname])) {
        $DB->insert_record('external_services_functions', (object) [
            'externalserviceid' => $service->id,
            'functionname' => $functionname,
        ]);
    }
}

$tokenrecord = $DB->get_record('external_tokens', [
    'tokentype' => EXTERNAL_TOKEN_PERMANENT,
    'externalserviceid' => $service->id,
    'userid' => $admin->id,
]);
if ($tokenrecord && in_array('--rotate-token', $argv, true)) {
    $DB->delete_records('external_tokens', ['id' => $tokenrecord->id]);
    $tokenrecord = false;
}
if ($tokenrecord) {
    $token = $tokenrecord->token;
} else {
    $token = external_generate_token(
        EXTERNAL_TOKEN_PERMANENT,
        $service->id,
        $admin->id,
        context_system::instance(),
        0,
        ''
    );
}

$result = json_encode([
    'courseId' => (string) $course->id,
    'courseName' => $course->fullname,
    'courseCode' => $course->shortname,
    'userIds' => $userids,
    'gradeItemIds' => $gradeitemids,
    'adminUserId' => (string) $admin->id,
    'token' => $token,
], JSON_THROW_ON_ERROR);
ob_end_clean();
echo $result;
