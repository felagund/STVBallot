/*
 * Licensed to Václav Novák under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership. ElasticSearch licenses this
 * file to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
function STV() {
}

(function() {
STV.prototype.validate = function(ballot) {
    if (ballot.invalid || ballot.empty) return "";
    var last = 0;
    var sorted = ballot.entries.sort();
    for (var i = 0; i < sorted.length; i++) {
        var e = sorted[i];
        if (e) {
            if (e != ++last) return e > last ? 'Chybí pořadí: ' + last : 'Duplicitní pořadí: ' + e;
        }
    }
    return "ok";
}

STV.prototype.crosscheck = function(pileGroup) {
    var piles = pileGroup.piles;
    var aggregatedPiles = [];
    for (var i = 0; i < piles.length; i++) {
        aggregatedPiles.push(STVDataBallot.aggregateBallots(piles[i].ballots));
    }
    var first = aggregatedPiles[0];
    var firstkeys = Object.keys(first).sort();
    for (var i = 1; i < aggregatedPiles.length; i++) {
        var ipile = aggregatedPiles[i];
        var ikeys = Object.keys(ipile).sort();
        if (ikeys.length != firstkeys.length) {
            console.log(pileGroup, ipile, first);
            return {status: "error", message: "Různá velikost hromádek"};
        }
        for (var j = 0; j < firstkeys.length; j++) {
            var key = firstkeys[j];
            if (key != ikeys[j]) return {status: "error", message: "Očekáváno " + key};
            if (first[key] != ipile[key]) return {status: "error", message: "Neshoda " + key};
        }
    }
    return {status: "ok", message: "ok"};
}

STV.prototype.ballot_header = function() { return "Pokyny pro hlasování: " +
    "<ul><li>Označte číslem pořadí kandidátů, ve kterém preferujete jejich zvolení. " +
    "U&nbsp;kandidáta, kterého upřednostňujete nejvíce, uveďte číslo 1, u&nbsp;kandidáta, " +
    "kterého považujete za druhého nejlepšího, uveďte číslo 2 atd., až očíslujete " +
    "podle vašich preferencí pořadí všech kandidátů, jejichž zvolení v&nbsp;tomto pořadí " +
    "preferujete před zvolením nikoho. Pokud nechcete svůj hlas dát nikomu z" +
    "&nbsp;kandidátů, neuvedete žádné číslo na hlasovacím lístku.</li>" +

    "<li>Hlas je neplatný, pokud uvedete stejné číslo u&nbsp;dvou kandidátů, pokud " +
    "nejnižší Vámi uvedené číslo není 1 nebo pokud Vámi uvedené čísla nejsou po " +
    "sobě jdoucí pořadová čísla.</li>" +

    "<li>Pokud po volbě nejsou obsazeny všechny mandáty voleného orgánu, konají " +
    "se nové volby na tyto mandáty.</li></ul>";
}

function stv_round(op) {
    var mandates = []; // Array of STVDataCandidates
    op.report("<p>Kvóta pro zvolení: " + STVDataSetup.round(op.quota) + "</p>");
    var mandateCount = op.admissible_candidates == null ? op.setup.mandateCount : op.admissible_candidates.length;
    var last_alive; // [candidate, score]
    while (mandates.length < mandateCount && Object.keys(op.ab).length > 0) { // a) iv)
        op.report("<p>Shrnutí vyplněných preferencí</p>" + STVDataBallot.reportAggregatedBallots(op.setup, op.ab));
        var fp = STVDataBallot.aggregateFirstPreferences(op.ab, op.setup, op.original_fp);
        if (fp.length == 0) break;
        op.report("<p>Počet hlasů s nejvyšší preferencí:<table>");
        fp.forEach(function(f) {op.report("<tr><td>" + STVDataSetup.round(f[0]) + "</td><td>" + f[1] + " (" + op.setup.candidates[f[1]-1].name + ")</td></tr>")});
        op.report("</table>");
        var has_elected = false;
        var i = 0;
        while (fp[i][0] >= op.quota && !op.deathmatch) {
            if (op.admissible_candidates != null) {
                if (!op.admissible_candidates.some(function(c) { // suboptimal, could have used hash instead
                    return c.name == op.setup.candidates[fp[i][1]-1].name;
                })) {
                    op.report("<p>" + op.setup.candidates[fp[i][1]-1].name + " nemůže být zvolen v kroce i), ignoruji.</p>");
                    i++;
                    continue;
                }
                else {
                    op.report(op.setup.candidates[fp[i][1]-1].name + " je volitelný v kroce i).");
                }
            }
            mandates.push(op.setup.candidates[fp[i][1]-1]);
            op.ab = STVDataBallot.removeCandidateFromAggregatedBallots(op.ab, fp[i][1], op.quota, false);
            op.report("<p>Kandidát <b>" + op.setup.candidates[fp[i][1]-1].name +"</b> (" + fp[i][1] +
                ") zvolen, na další místa se přesouvá " + STVDataSetup.round(fp[i][0]-op.quota) +
                " (" + new Number((fp[i][0]-op.quota)/fp[i][0]*100).toFixed(1)  + " %) hlasů</p>");
            has_elected = true;
            break;
        }
        if (!has_elected) {
            var last = fp.length - 1;
            last_alive = [op.setup.candidates[fp[last][1]-1], fp[last][0]];
            op.report("<p>Žádný kandidát není zvolen, odstraňuji kandidáta " + last_alive[0].name + " ("  + fp[last][1] + ")</p>");
            op.ab = STVDataBallot.removeCandidateFromAggregatedBallots(op.ab, fp[last][1], 0, op.soft_remove);
        }
    }
    if (op.deathmatch) {
        if (last_alive[1] >= op.quota) {
            op.report("Kandidát " + last_alive[0].name + " vyřazen jako poslední a tím zvolen s počtem hlasů " + last_alive[1]);
            mandates.push(last_alive[0]);
        }
        else {
            op.report("Poslední vyřazený kandidát nepřekročil kvótu. Nikdo není zvolen.")
        }
    }
    else if (mandates.length >= mandateCount) {
        op.report("<p>Sčítání ukončeno, neboť stanovený počet mandátů byl obsazen.</p>");
    }
    else {
        op.report("<p>Sčítání ukončeno, neboť všichni kandidáti byli zvoleni nebo vyřazeni.</p>");
    }
    op.report("<h5>Zvolení kandidáti:</h5>" + mandates.map(function(c){return c.name;}).join(", ") + ". ");
    return mandates;
}

STV.prototype.run = function(setup, ballots, report, done) {
    var ab = STVDataBallot.aggregateBallots(ballots);
    var original_ab = STVDataBallot.clone_ab(ab);
    var original_fp = STVDataBallot.aggregateFirstPreferences(ab, setup, null);
    var valid_ballots_count = ballots.length - ab['_invalid'];
    report(
        "<h1>Výpočet volby: " + setup.voteNo + "</h1>" +
        "<p>Z " + setup.candidateCount + " kandidátů voleno " + setup.mandateCount + " mandátů, z toho " +
        setup.orderedCount + " pozic s pořadím. Odevzdáno " + ballots.length + " hlasovacích lístků.<br/>" +
        "Neplatných lístků: " + ab['_invalid'] + ", prázdných lístků: " + ab['_empty'] + "</p>" +
        "<p>Kandidáti:<table><tr>" + setup.candidates.map(function(c){
            return "<td>" + c.gender + "</td><td>" + c.name + "</td><td>" +
            c.acceptable_positions.map(function(p){return p?'✓':'✗';}) + "</td>";
            }).join("</tr><tr>") +
        "</tr></table></p>" +
        "<p>Maximální počet mužů: " + (setup.m_max > 0 ? setup.m_max : 'neomezen')  + ", " +
        "maximální počet žen: " + (setup.f_max > 0 ? setup.f_max : 'neomezen') + "<br/>" +
        "Počet platných hlasovacích lístků: " + valid_ballots_count + "</p>"
    );
    var quota = valid_ballots_count / (setup.mandateCount + 1) + 0.00001;
    var candidate_orders = {};
    setup.candidates.forEach(function(c, i) {
        candidate_orders[c.name] = i + 1;
    });
    var mandates;
    if (setup.f_max == 0 &&  setup.m_max == 0 && setup.orderedCount == 0) {
        // plain STV:
        mandates = stv_round({
            "setup": setup, "ab": ab, "report": report, "quota": quota, "original_fp": original_fp
        });
        report("<h1>Výpočet náhradníků</h1>");
        mandates.forEach(function(mandate) {
            var new_ab = STVDataBallot.clone_ab(original_ab);
            var cnum = candidate_orders[mandate.name];
            report("<p>Výpočet náhradníka za: " + mandate.name + " (kandidát č. " + cnum + ")<br/>");
            new_ab = STVDataBallot.removeCandidateFromAggregatedBallots(new_ab, cnum, 0, false);
            var new_mandates = stv_round({
                "setup": setup, "ab": new_ab, "report": report, "quota": quota, "original_fp": original_fp
            });
            var omandates = mandates.map(function(x){return x;}).sort(function(a, b) {return a.name.localeCompare(b.name)});
            new_mandates.push(mandate);
            new_mandates.sort(function(a, b) {return a.name.localeCompare(b.name)}).some(function(m, i) {
                if (i < omandates.length && m.name == omandates[i].name) {
                    return false;
                }
                else {
                    report("Náhradníkem za " + mandate.name + " se tedy stává " + m.name);
                    return true;
                }
            });
            report("</p>");
        });
    }
    else {
        // top-down STV
        mandates = [];
        for (var round = 1; round <= setup.mandateCount; round++) {
            var round_quota;
            var new_ab = STVDataBallot.clone_ab(original_ab);
            if (round <= setup.orderedCount) {
                report("<h5>Výpočet pro obsazení pozice č. " + round + "</h5>");
                round_quota = valid_ballots_count / (round + 1) + 0.00001;
            }
            else {
                report("<h5>Kolo č. " + round + "</h5>");
                round_quota = quota;
            }
            // krok i)
            if (round > 1) {
                report("Krok i: odstranění již zvolených kandidátů");
                var op_step1 = {
                    "soft_remove": true, "admissible_candidates": mandates, "setup": setup, "ab": new_ab, "report": report, "quota": round_quota, "original_fp": original_fp
                };
                stv_round(op_step1);
                new_ab = op_step1["ab"];
            // krok ii)
                new_ab = STVDataBallot.reinsert_to_ab(new_ab, candidate_orders, mandates);
                report("<p>Preference po vrácení kandidátů vyřazených v kroku i)</p>" + STVDataBallot.reportAggregatedBallots(setup, new_ab));
            }
            new_ab = STVDataBallot.remove_gender_violators_from_ab(new_ab, setup, report, candidate_orders, mandates);
            report("Krok ii: volba mandátu<br/>");
            if (round <= setup.orderedCount) {
                new_ab = STVDataBallot.remove_non_candidates(new_ab, setup, round, report);
            }
            var new_mandates = stv_round({
                "deathmatch": true, "setup": setup, "ab": new_ab, "report": report, "quota": round_quota, "original_fp": original_fp
            });
            if (new_mandates.length > 0) {
                report("<br/>V kole č. " + round + " byl zvolen kandidát: " + new_mandates[0].name + ".");
                mandates.push(new_mandates[0]);
            }
            else {
                report("V kole č. " + round + " nebyl zvolen žádný kandidát.");
            }
        }
    }
    report("<h2>Zvolení kandidáti:</h2><ul><li>" + mandates.map(function(c){return c.name;}).join("</li><li>") + "</li></ul>");
    done(mandates);
}

})()
