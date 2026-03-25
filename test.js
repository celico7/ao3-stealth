fetch('https://archiveofourown.org/works/75265511/chapters/215030436').then(r=>r.text()).then(html=>{
    console.log(html.substring(0, 1000));
    console.log("WORK_SKIN_PRESENT:", html.includes("workskin"));
    console.log("TOS_PRESENT:", html.includes("I agree/consent to these Terms"));
});